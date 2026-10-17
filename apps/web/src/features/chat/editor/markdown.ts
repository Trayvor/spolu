import { mentionToken, MENTION_ALL_TOKEN } from '@spolu/shared';
import type { Fragment, Mark, Node } from 'prosemirror-model';
import { parseMessage, safeHref, type Block, type Inline } from '../format/parse';
import { schema } from './schema';

/** How mentions are labelled in the editor: `@Name`, the @all label, or the unknown label. */
export interface MentionLabels {
  all: string;
  unknown: string;
}

const { nodes, marks } = schema;

/**
 * Markdown (the stored message body, mention tokens included) → editor document. It reuses the
 * message parser, so the editor holds exactly what the chat renders. Every line of a paragraph
 * becomes its own paragraph, and a blank line between two paragraphs an empty one, so the draft
 * shows lines the way they were typed.
 */
export function toDoc(
  body: string,
  nameOf: (id: string) => string | undefined,
  labels: MentionLabels,
): Node {
  const labelOf = (id: string) => {
    if (id === 'all') return labels.all;
    const name = nameOf(id);
    return name === undefined ? labels.unknown : `@${name}`;
  };

  const inlines = (list: Inline[], active: readonly Mark[] = []): Node[] =>
    list.flatMap((node): Node[] => {
      switch (node.type) {
        case 'text':
          return node.text ? [schema.text(node.text, active)] : [];
        case 'code':
          return node.text ? [schema.text(node.text, marks.code.create().addToSet(active))] : [];
        case 'bold':
        case 'italic':
        case 'strike':
          return inlines(node.children, marks[node.type].create().addToSet(active));
        case 'link':
          return inlines(node.children, marks.link.create({ href: node.href }).addToSet(active));
        case 'mention':
        case 'mentionAll': {
          const id = node.type === 'mention' ? node.userId : 'all';
          const allowed = active.filter((m) => m.type !== marks.code);
          return [nodes.mention.create({ id, label: labelOf(id) }, null, allowed)];
        }
        case 'break':
          return [nodes.hard_break.create()];
      }
    });

  /** Splits at the line breaks: one paragraph per line. */
  const lines = (list: Inline[]): Node[] => {
    const result: Node[] = [];
    let line: Node[] = [];
    for (const node of inlines(list)) {
      if (node.type === nodes.hard_break) {
        result.push(nodes.paragraph.create(null, line));
        line = [];
      } else {
        line.push(node);
      }
    }
    result.push(nodes.paragraph.create(null, line));
    return result;
  };

  const blocks = (list: Block[]): Node[] => {
    const result: Node[] = [];
    list.forEach((block, i) => {
      // Two paragraphs in a row were apart by a blank line.
      if (block.type === 'paragraph' && list[i - 1]?.type === 'paragraph') {
        result.push(nodes.paragraph.create());
      }
      switch (block.type) {
        case 'paragraph':
          result.push(...lines(block.children));
          break;
        case 'heading':
          result.push(nodes.heading.create({ level: block.level }, inlines(block.children)));
          break;
        case 'codeBlock':
          result.push(nodes.code_block.create(null, block.text ? schema.text(block.text) : null));
          break;
        case 'quote': {
          const inner = blocks(block.children);
          result.push(
            nodes.blockquote.create(null, inner.length ? inner : nodes.paragraph.create()),
          );
          break;
        }
        case 'list': {
          const type = block.ordered ? nodes.ordered_list : nodes.bullet_list;
          const items = block.items.map((item) =>
            nodes.list_item.create(null, nodes.paragraph.create(null, inlines(item))),
          );
          result.push(type.create(block.ordered ? { order: block.start } : null, items));
          break;
        }
      }
    });
    return result;
  };

  const content = blocks(parseMessage(body));
  return nodes.doc.create(null, content.length ? content : nodes.paragraph.create());
}

/** Editor document → Markdown, the inverse of `toDoc` (see the spec's "Storage model"). */
export function toMarkdown(doc: Node): string {
  return blockLines(doc.content).join('\n');
}

function blockLines(content: Fragment): string[] {
  const out: string[] = [];
  content.forEach((node) => {
    switch (node.type) {
      case nodes.paragraph:
        out.push(inlineMarkdown(node, '\n'));
        break;
      case nodes.heading:
        out.push(`${'#'.repeat(node.attrs.level as number)} ${inlineMarkdown(node, ' ')}`);
        break;
      case nodes.code_block:
        out.push('```', ...node.textContent.split('\n'), '```');
        break;
      case nodes.blockquote:
        for (const line of blockLines(node.content)) out.push(line ? `> ${line}` : '>');
        break;
      case nodes.bullet_list:
      case nodes.ordered_list: {
        const start = node.attrs.order as number | undefined;
        node.forEach((item, _offset, i) => {
          const marker = start === undefined ? '- ' : `${start + i}. `;
          out.push(marker + (item.firstChild ? inlineMarkdown(item.firstChild, ' ') : ''));
        });
        break;
      }
    }
  });
  return out;
}

interface Piece {
  text: string;
  marks: readonly Mark[];
  /** Mentions and breaks: written as they are, never split at spaces. */
  atom: boolean;
}

const OPEN: Record<string, string> = {
  bold: '**',
  italic: '_',
  strike: '~~',
  code: '`',
  link: '[',
};
const close = (mark: Mark) =>
  mark.type === marks.link ? `](${mark.attrs.href as string})` : (OPEN[mark.type.name] as string);
const has = (list: readonly Mark[], mark: Mark) => list.some((m) => m.eq(mark));

/** One textblock's inline content as Markdown; `breakAs` is what a hard break becomes. */
function inlineMarkdown(block: Node, breakAs: string): string {
  const raw: Piece[] = [];
  block.forEach((node) => {
    if (node.isText) raw.push({ text: node.text as string, marks: node.marks, atom: false });
    else if (node.type === nodes.hard_break) raw.push({ text: breakAs, marks: [], atom: true });
    else if (node.type === nodes.mention) {
      const id = node.attrs.id as string;
      raw.push({
        text: id === 'all' ? MENTION_ALL_TOKEN : mentionToken(id),
        marks: node.marks,
        atom: true,
      });
    }
  });

  bareLinks(raw);

  // Spaces at the edge of a mark move outside it (`**hi **` would not parse); code keeps them.
  const pieces: Piece[] = [];
  raw.forEach((piece, i) => {
    if (piece.atom || piece.marks.length === 0) {
      pieces.push(piece);
      return;
    }
    const keep = (neighbour: Piece | undefined) => (m: Mark) =>
      m.type === marks.code || (neighbour !== undefined && has(neighbour.marks, m));
    const lead = /^\s*/.exec(piece.text)![0];
    const rest = piece.text.slice(lead.length);
    const trail = /\s*$/.exec(rest)![0];
    const middle = rest.slice(0, rest.length - trail.length);
    if (lead) pieces.push({ text: lead, marks: piece.marks.filter(keep(raw[i - 1])), atom: false });
    if (middle) pieces.push({ text: middle, marks: piece.marks, atom: false });
    if (trail)
      pieces.push({ text: trail, marks: piece.marks.filter(keep(raw[i + 1])), atom: false });
  });

  let out = '';
  const open: Mark[] = [];
  for (const piece of pieces) {
    let same = 0;
    while (same < open.length && same < piece.marks.length && open[same]!.eq(piece.marks[same]!)) {
      same++;
    }
    while (open.length > same) out += close(open.pop()!);
    for (const mark of piece.marks.slice(same)) {
      out += OPEN[mark.type.name];
      open.push(mark);
    }
    out += piece.text;
  }
  while (open.length) out += close(open.pop()!);
  return out;
}

/** A link whose text is its own address is written bare (the renderer links it again). */
function bareLinks(pieces: Piece[]) {
  let i = 0;
  while (i < pieces.length) {
    const link = pieces[i]!.marks.find((m) => m.type === marks.link);
    if (!link) {
      i++;
      continue;
    }
    let j = i;
    while (j < pieces.length && has(pieces[j]!.marks, link)) j++;
    const run = pieces.slice(i, j);
    const text = run.map((p) => p.text).join('');
    const plain = run.every((p) => !p.atom && p.marks.length === 1);
    if (plain && /^(https?:\/\/|mailto:)\S+$/i.test(text) && safeHref(text) === link.attrs.href) {
      for (let k = i; k < j; k++) pieces[k] = { ...pieces[k]!, marks: [] };
    }
    i = j;
  }
}
