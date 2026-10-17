import type { BulkBlock, BulkInline, BulkLeafBlock, BulkTextNode } from './bulk-email.js';

/**
 * Phase 31 — helpers over the bulk email content (types only from `bulk-email.ts`, so the
 * schema can use them without an import cycle at runtime): the 1 → 2 upgrade, walking the
 * blocks of split containers, and counting.
 */

/** Every block of a version, containers first and then their left and right blocks. */
export function flattenBlocks(blocks: readonly BulkBlock[]): BulkBlock[] {
  return blocks.flatMap((b): BulkBlock[] =>
    b.type === 'columns' ? [b, ...b.left, ...b.right] : [b],
  );
}

/** The blocks of a version, counting the blocks inside containers (the 50-block limit). */
export function countBlocks(blocks: readonly BulkBlock[]): number {
  return blocks.reduce(
    (n, b) => n + 1 + (b.type === 'columns' ? b.left.length + b.right.length : 0),
    0,
  );
}

/** All characters of a text's runs (the 5 000-character limit). */
export function textOfNodes(nodes: readonly BulkTextNode[]): string {
  return nodes.map((node) => node.content.map((run) => run.text).join('')).join('');
}

/** The image ids of one or more versions, inside containers too. */
export function imageIdsOfBlocks(
  ...versions: (readonly BulkBlock[] | null | undefined)[]
): string[] {
  const ids = versions.flatMap((blocks) =>
    flattenBlocks(blocks ?? []).flatMap((b) => (b.type === 'image' ? [b.imageId] : [])),
  );
  return [...new Set(ids)];
}

/** Paragraphs split on a blank line; empty ones dropped; `\r\n` normalised (Phase 23 rules). */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim() !== '');
}

/** `a **b** c` → plain, bold, plain. An unclosed `**` stays as written; never spans a line. */
export function splitBold(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), bold: false });
    out.push({ text: m[1]!, bold: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), bold: false });
  return out;
}

/** The runs of a Phase 23 text: `**bold**` becomes the `bold` mark. */
export function runsFromMarkdownBold(text: string): BulkInline[] {
  return splitBold(text).map(({ text: t, bold }) =>
    bold ? { text: t, marks: ['bold'] } : { text: t },
  );
}

type V1Text = { id: string; type: 'text'; text?: unknown; align?: unknown };

function upgradeLeaf(block: BulkLeafBlock | V1Text): BulkLeafBlock {
  if (block.type !== 'text' || !('text' in block) || typeof block.text !== 'string') {
    return block as BulkLeafBlock;
  }
  const { text, ...rest } = block;
  return {
    ...(rest as Omit<Extract<BulkLeafBlock, { type: 'text' }>, 'content'>),
    content: splitParagraphs(text).map((p) => ({
      type: 'paragraph' as const,
      content: runsFromMarkdownBold(p),
    })),
  };
}

/**
 * The stored blocks of `version` as content version 2. Version 1 (Phase 23) text blocks
 * `{ text, align }` become paragraphs with bold runs, read exactly as the Phase 23 renderer did,
 * so they render the same. Version 2 is returned as stored; anything that is not a list is no
 * blocks.
 */
export function upgradeBlocks(version: number, raw: unknown): BulkBlock[] {
  if (!Array.isArray(raw)) return [];
  if (version >= 2) return raw as BulkBlock[];
  return (raw as (BulkBlock | V1Text)[]).map((block): BulkBlock => {
    if (block.type === 'columns') {
      return { ...block, left: block.left.map(upgradeLeaf), right: block.right.map(upgradeLeaf) };
    }
    return upgradeLeaf(block as BulkLeafBlock | V1Text);
  });
}
