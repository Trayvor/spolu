import { describe, expect, it } from 'vitest';
import {
  BulkBlockSchema,
  BulkBlocksSchema,
  BulkCampaignDraftSchema,
  BulkInlineSchema,
  type BulkBlock,
} from './bulk-email.js';
import {
  countBlocks,
  flattenBlocks,
  splitBold,
  textOfNodes,
  upgradeBlocks,
} from './bulk-email-content.js';

const p = (text: string, extra: object = {}) => ({
  type: 'paragraph',
  content: [{ text, ...extra }],
});
const textBlock = (content: unknown[]) => ({ id: 't', type: 'text', align: 'left', content });
const ok = (block: unknown) => BulkBlockSchema.safeParse(block).success;

describe('rich text: the schema is the allowlist', () => {
  it('accepts marks, links, palette colours, headings, lists and alignment', () => {
    expect(
      ok(
        textBlock([
          { type: 'h2', align: 'center', content: [{ text: 'Title' }] },
          { type: 'h3', content: [{ text: 'Sub' }] },
          p('bold', { marks: ['bold', 'italic', 'underline', 'strike'] }),
          p('link', { href: 'https://egrant.sk/a?b=1', color: 'purple' }),
          p('mail', { href: 'mailto:info@egrant.sk' }),
          { type: 'bullet', align: 'right', content: [{ text: 'one' }] },
          { type: 'ordered', content: [{ text: 'two' }] },
        ]),
      ),
    ).toBe(true);
  });

  it('rejects javascript:, data: and relative links in any casing or padding', () => {
    for (const href of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,<script>x</script>',
      '/relative',
      'vbscript:x',
      'mailto:',
    ]) {
      expect(ok(textBlock([p('x', { href })])), href).toBe(false);
    }
  });

  it('rejects a CSS value or an unknown key as a colour', () => {
    for (const color of ['crimson', '#ff0000', 'ink;background:url(x)', 'line']) {
      expect(ok(textBlock([p('x', { color })])), color).toBe(false);
    }
  });

  it('rejects unknown marks, node types and repeated marks', () => {
    expect(ok(textBlock([p('x', { marks: ['script'] })]))).toBe(false);
    expect(ok(textBlock([p('x', { marks: ['bold', 'bold'] })]))).toBe(false);
    expect(ok(textBlock([{ type: 'html', content: [{ text: '<b>' }] }]))).toBe(false);
    expect(ok(textBlock([{ type: 'h1', content: [{ text: 'x' }] }]))).toBe(false);
  });

  it('strips unknown keys such as html, style or onclick', () => {
    const parsed = BulkInlineSchema.parse({
      text: 'x',
      html: '<img onerror=alert(1)>',
      style: 'x',
      onclick: 'y',
    });
    expect(parsed).toEqual({ text: 'x' });
  });
});

describe('images, spacer and columns', () => {
  const image = { id: 'i', type: 'image', imageId: 'img', alt: 'A' };

  it('image width: percent 10–100, px 40–520', () => {
    expect(ok({ ...image, width: { unit: 'percent', value: 50 } })).toBe(true);
    expect(ok({ ...image, width: { unit: 'percent', value: 101 } })).toBe(false);
    expect(ok({ ...image, width: { unit: 'percent', value: 5 } })).toBe(false);
    expect(ok({ ...image, width: { unit: 'px', value: 520 } })).toBe(true);
    expect(ok({ ...image, width: { unit: 'px', value: 521 } })).toBe(false);
    expect(ok({ ...image, width: { unit: 'px', value: 200.5 } })).toBe(false);
  });

  it('image align and shape', () => {
    expect(ok({ ...image, align: 'right', shape: 'circle' })).toBe(true);
    expect(ok({ ...image, shape: 'rounded' })).toBe(true);
    expect(ok({ ...image, shape: 'roundedLarge' })).toBe(true);
    expect(ok({ ...image, shape: 'star' })).toBe(false);
  });

  it('spacer sizes', () => {
    expect(ok({ id: 's', type: 'spacer', size: 'medium' })).toBe(true);
    expect(ok({ id: 's', type: 'spacer', size: 'huge' })).toBe(false);
  });

  const columns = (left: unknown[], right: unknown[] = [], extra: object = {}) => ({
    id: 'c',
    type: 'columns',
    ratio: '50-50',
    valign: 'top',
    divider: true,
    dividerColor: 'line',
    left,
    right,
    ...extra,
  });

  it('a container takes leaf blocks on both sides', () => {
    expect(ok(columns([image], [{ id: 'd', type: 'divider' }]))).toBe(true);
    expect(ok(columns([], []))).toBe(true);
  });

  it('a container inside a container is rejected', () => {
    expect(ok(columns([columns([])]))).toBe(false);
  });

  it('ratio, valign and divider colour are allowlisted', () => {
    expect(ok(columns([], [], { ratio: '33-67' }))).toBe(true);
    expect(ok(columns([], [], { ratio: '10-90' }))).toBe(false);
    expect(ok(columns([], [], { valign: 'stretch' }))).toBe(false);
    expect(ok(columns([], [], { dividerColor: 'red' }))).toBe(false);
  });

  it('at most 50 blocks in a version, counting the blocks inside containers', () => {
    const dividers = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `d${i}`, type: 'divider' }));
    expect(
      BulkBlocksSchema.safeParse([columns(dividers(20), dividers(20)), ...dividers(9)]).success,
    ).toBe(true);
    expect(
      BulkBlocksSchema.safeParse([columns(dividers(20), dividers(20)), ...dividers(10)]).success,
    ).toBe(false);
  });
});

describe('draft with a phone version', () => {
  const draft = (extra: object) => ({
    name: 'N',
    subject: 'S',
    preheader: '',
    blocks: [],
    audience: {},
    version: 1,
    ...extra,
  });

  it('phoneBlocks is optional and nullable', () => {
    expect(BulkCampaignDraftSchema.parse(draft({})).phoneBlocks).toBeUndefined();
    expect(BulkCampaignDraftSchema.parse(draft({ phoneBlocks: null })).phoneBlocks).toBeNull();
    expect(
      BulkCampaignDraftSchema.parse(draft({ phoneBlocks: [{ id: 'd', type: 'divider' }] }))
        .phoneBlocks,
    ).toHaveLength(1);
  });
});

describe('upgradeBlocks (content version 1 → 2)', () => {
  it('turns a v1 text into paragraphs with bold runs, as the Phase 23 renderer read it', () => {
    const [block] = upgradeBlocks(1, [
      { id: 't', type: 'text', text: 'A **b** c\nline\n\n\nNext ** open', align: 'center' },
    ]);
    expect(block).toEqual({
      id: 't',
      type: 'text',
      align: 'center',
      content: [
        {
          type: 'paragraph',
          content: [{ text: 'A ' }, { text: 'b', marks: ['bold'] }, { text: ' c\nline' }],
        },
        { type: 'paragraph', content: [{ text: 'Next ** open' }] },
      ],
    });
    expect(BulkBlockSchema.safeParse(block).success).toBe(true);
  });

  it('an empty v1 text has no nodes; other blocks are unchanged', () => {
    const blocks = upgradeBlocks(1, [
      { id: 't', type: 'text', text: '', align: 'left' },
      { id: 'b', type: 'button', label: 'x', url: 'https://e.test', align: 'left' },
    ]);
    expect(blocks[0]).toEqual({ id: 't', type: 'text', align: 'left', content: [] });
    expect(blocks[1]).toEqual({
      id: 'b',
      type: 'button',
      label: 'x',
      url: 'https://e.test',
      align: 'left',
    });
  });

  it('version 2 is returned as stored; a non-array is no blocks', () => {
    const v2: BulkBlock[] = [{ id: 'd', type: 'divider' }];
    expect(upgradeBlocks(2, v2)).toBe(v2);
    expect(upgradeBlocks(1, null)).toEqual([]);
  });

  it('splitBold leaves an unclosed ** and never spans lines', () => {
    expect(splitBold('a **b\nc** d')).toEqual([{ text: 'a **b\nc** d', bold: false }]);
    expect(splitBold('**x**')).toEqual([{ text: 'x', bold: true }]);
  });
});

describe('helpers', () => {
  const tree: BulkBlock[] = [
    { id: 'i1', type: 'image', imageId: 'a', alt: 'A' },
    {
      id: 'c',
      type: 'columns',
      ratio: '50-50',
      valign: 'top',
      divider: false,
      dividerColor: 'line',
      left: [{ id: 'i2', type: 'image', imageId: 'b', alt: 'B' }],
      right: [{ id: 'd', type: 'divider' }],
    },
  ];

  it('flattenBlocks walks into containers; countBlocks counts every block', () => {
    expect(flattenBlocks(tree).map((b) => b.id)).toEqual(['i1', 'c', 'i2', 'd']);
    expect(countBlocks(tree)).toBe(4);
  });

  it('textOfNodes is the characters of every run', () => {
    expect(
      textOfNodes([p('ab'), { type: 'h2', content: [{ text: 'c' }, { text: 'de' }] }] as never),
    ).toBe('abcde');
  });
});
