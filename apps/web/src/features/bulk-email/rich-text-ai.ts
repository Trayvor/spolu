import { isBulkLinkUrl, splitBold, type BulkInline, type BulkTextNode } from '@spolu/shared';

/**
 * The text block's tree ↔ the Markdown-like text the AI tools and the microphone work on: `## `
 * and `### ` headings, `- ` and `1. ` list items, `**bold**` and `[text](https://…)` links, one
 * line per node. Underline, strike-through, italic, colours and per-node alignment are not
 * written; the editor keeps the original tree for an Undo and for an appended dictation (see
 * `rich-text-ai-tools.tsx`), so only an AI rewrite replaces them.
 */

function runToText(run: BulkInline): string {
  let text = run.text.replace(/\n/g, ' ');
  if (run.marks?.includes('bold') && text.trim() !== '') text = `**${text}**`;
  if (run.href) text = `[${text}](${run.href})`;
  return text;
}

export function nodesToText(nodes: readonly BulkTextNode[]): string {
  const lines: string[] = [];
  let number = 0;
  let previous: BulkTextNode['type'] | null = null;
  for (const node of nodes) {
    const body = node.content.map(runToText).join('');
    const list = node.type === 'bullet' || node.type === 'ordered';
    number = node.type === 'ordered' ? number + 1 : 0;
    // A blank line between paragraphs and headings; list items follow each other.
    if (lines.length > 0 && !(list && previous === node.type)) lines.push('');
    if (node.type === 'h2') lines.push(`## ${body}`);
    else if (node.type === 'h3') lines.push(`### ${body}`);
    else if (node.type === 'bullet') lines.push(`- ${body}`);
    else if (node.type === 'ordered') lines.push(`${number}. ${body}`);
    else lines.push(body);
    previous = node.type;
  }
  return lines.join('\n');
}

const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function inline(text: string): BulkInline[] {
  const runs: BulkInline[] = [];
  const plain = (chunk: string, href?: string) => {
    for (const part of splitBold(chunk)) {
      if (part.text === '') continue;
      runs.push({
        text: part.text,
        ...(part.bold ? { marks: ['bold' as const] } : {}),
        ...(href ? { href } : {}),
      });
    }
  };
  let at = 0;
  for (const m of text.matchAll(LINK_RE)) {
    // A link the email may not hold stays as the text the person wrote.
    if (!isBulkLinkUrl(m[2]!)) continue;
    plain(text.slice(at, m.index));
    plain(m[1]!, m[2]!);
    at = m.index + m[0].length;
  }
  plain(text.slice(at));
  return runs;
}

export function textToNodes(text: string): BulkTextNode[] {
  const nodes: BulkTextNode[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      nodes.push({ type: heading[1] === '###' ? 'h3' : 'h2', content: inline(heading[2]!) });
    } else if (bullet) nodes.push({ type: 'bullet', content: inline(bullet[1]!) });
    else if (ordered) nodes.push({ type: 'ordered', content: inline(ordered[1]!) });
    else nodes.push({ type: 'paragraph', content: inline(line) });
  }
  return nodes;
}
