import { describe, expect, it } from 'vitest';
import type { BulkBlock, BulkInline, BulkLeafBlock, BulkTextNode } from '@spolu/shared';
import { renderCampaign } from './render.js';

/** Phase 30: the builder v2 blocks (spec §3). */

function render(
  blocks: BulkBlock[],
  opts: Partial<Parameters<typeof renderCampaign>[0]> = {},
): { html: string; text: string } {
  return renderCampaign({
    subject: 'S',
    preheader: '',
    blocks,
    recipient: { name: 'Jana <J>', language: 'sk' },
    unsubscribeHref: 'https://spolu.test/u',
    publicUrl: 'https://spolu.test',
    ...opts,
  });
}

const text = (...content: BulkTextNode[]): BulkBlock => ({
  id: 't',
  type: 'text',
  align: 'left',
  content,
});
const para = (...content: BulkInline[]): BulkTextNode => ({ type: 'paragraph', content });
const image = (extra: Partial<Extract<BulkBlock, { type: 'image' }>> = {}): BulkLeafBlock => ({
  id: 'i',
  type: 'image',
  imageId: 'img',
  alt: 'Alt',
  ...extra,
});
const columns = (
  left: BulkLeafBlock[],
  right: BulkLeafBlock[],
  extra: Partial<Extract<BulkBlock, { type: 'columns' }>> = {},
): BulkBlock => ({
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

describe('text formatting', () => {
  it('renders bold, italic, underline, strikethrough and colour with inline styles', () => {
    const { html } = render([
      text(
        para(
          { text: 'B', marks: ['bold'] },
          { text: 'I', marks: ['italic'] },
          { text: 'U', marks: ['underline'] },
          { text: 'S', marks: ['strike'] },
          { text: 'US', marks: ['underline', 'strike'] },
          { text: 'C', color: 'purple' },
        ),
      ),
    ]);
    expect(html).toContain('<strong style="font-weight:600">B</strong>');
    expect(html).toContain('<em style="font-style:italic">I</em>');
    expect(html).toContain('<span style="text-decoration:underline">U</span>');
    expect(html).toContain('<span style="text-decoration:line-through">S</span>');
    expect(html).toContain('<span style="text-decoration:underline line-through">US</span>');
    expect(html).toContain('<span style="color:#7654FF">C</span>');
  });

  it('renders a link run with its colour, and mailto:', () => {
    const { html, text: plain } = render([
      text(
        para(
          { text: 'eGrant', href: 'https://egrant.sk/?a=1&b=2', color: 'blue' },
          { text: ' / ' },
          { text: 'mail', href: 'mailto:info@egrant.sk' },
        ),
      ),
    ]);
    expect(html).toContain(
      '<a href="https://egrant.sk/?a=1&amp;b=2" target="_blank" style="color:#3242DC;text-decoration:underline">eGrant</a>',
    );
    expect(html).toContain('href="mailto:info@egrant.sk"');
    expect(plain).toContain('eGrant (https://egrant.sk/?a=1&b=2) / mail (mailto:info@egrant.sk)');
  });

  it('headings level 2 and 3, alignment per node, block alignment as default', () => {
    const { html, text: plain } = render([
      {
        id: 't',
        type: 'text',
        align: 'center',
        content: [
          { type: 'h2', content: [{ text: 'Two' }] },
          { type: 'h3', align: 'right', content: [{ text: 'Three' }] },
          para({ text: 'Body' }),
        ],
      },
    ]);
    expect(html).toMatch(
      /<h2 style="margin:0 0 12px 0;[^"]*font-size:22px[^"]*text-align:center">Two<\/h2>/,
    );
    expect(html).toMatch(
      /<h3 style="margin:0 0 12px 0;[^"]*font-size:18px[^"]*text-align:right">Three<\/h3>/,
    );
    expect(html).toMatch(/<p style="margin:0 0 0px 0;[^"]*text-align:center">Body<\/p>/);
    expect(html).toContain('<td align="center"');
    expect(plain).toContain('TWO\n\nTHREE\n\nBody');
  });

  it('consecutive list items make one list; the text part numbers them', () => {
    const { html, text: plain } = render([
      text(
        { type: 'bullet', content: [{ text: 'a' }] },
        { type: 'bullet', content: [{ text: 'b' }] },
        para({ text: 'mid' }),
        { type: 'ordered', content: [{ text: 'one' }] },
        { type: 'ordered', content: [{ text: 'two' }] },
      ),
    ]);
    expect(html.match(/<ul\b/g)).toHaveLength(1);
    expect(html.match(/<ol\b/g)).toHaveLength(1);
    expect(html.match(/<li\b/g)).toHaveLength(4);
    expect(html).toMatch(/<ul style="margin:0 0 16px 0;padding:0 0 0 24px;[^"]*">/);
    expect(plain).toContain('- a\n- b\n\nmid\n\n1. one\n2. two');
  });

  it('keeps {{name}} personalization, escaped, inside formatted runs and links', () => {
    const { html } = render([
      text(
        para(
          { text: 'Ahoj {{name}}', marks: ['bold'] },
          { text: ' {{name}}', href: 'https://egrant.sk' },
        ),
      ),
    ]);
    expect(html).toContain('<strong style="font-weight:600">Ahoj Jana &lt;J&gt;</strong>');
    expect(html).toMatch(/<a href="https:\/\/egrant\.sk"[^>]*> Jana &lt;J&gt;<\/a>/);
    expect(html).not.toContain('{{name}}');
  });

  it('a line break in a run is <br />; plain URLs outside links are still linked', () => {
    const { html } = render([text(para({ text: 'a\nsee https://egrant.sk.' }))]);
    expect(html).toContain('a<br />see <a href="https://egrant.sk"');
  });
});

describe('sanitization (defence in depth: the renderer never trusts its input)', () => {
  it('escapes markup in runs; never renders a javascript: link or a CSS colour', () => {
    const evil = [
      {
        id: 't',
        type: 'text',
        align: 'left',
        content: [
          {
            type: 'paragraph',
            content: [
              { text: '<img src=x onerror=alert(1)>' },
              { text: 'x', href: 'javascript:alert(1)' },
              { text: 'y', href: ' data:text/html,<script>' },
              { text: 'z', color: 'red;background:url(javascript:alert(1))' },
              { text: 'w', marks: ['<script>'] },
            ],
          },
        ],
      },
    ] as unknown as BulkBlock[];
    const { html } = render(evil);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toMatch(/<img src=x/);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text');
    expect(html).not.toContain('background:url');
    expect(html).not.toContain('<script');
    // No event handler attribute in any tag (the escaped text above is not a tag).
    expect(html).not.toMatch(/<[^>]*\son[a-z]+=/i);
  });

  it('an unknown node type renders as a paragraph, never as a tag of its name', () => {
    const { html } = render([
      {
        id: 't',
        type: 'text',
        align: 'left',
        content: [{ type: 'script', content: [{ text: 'x' }] }],
      },
    ] as unknown as BulkBlock[]);
    expect(html).not.toContain('<script');
    expect(html).toMatch(/<p [^>]*>x<\/p>/);
  });

  it('an unknown image shape, width or align is ignored', () => {
    const { html } = render([
      image({
        shape: 'x;behavior:url(y)',
        align: 'x" onload="y',
        width: { unit: 'em', value: 3 },
      } as never),
    ]);
    expect(html).not.toContain('behavior');
    expect(html).not.toContain('onload');
    expect(html).toMatch(/<img [^>]*width="520"/);
  });
});

describe('images: size, alignment, shape', () => {
  const sizes = new Map([['img', { width: 1000, height: 500 }]]);

  it('percent of the column, with the height from the ratio', () => {
    const { html } = render([image({ width: { unit: 'percent', value: 50 } })], {
      imageSizes: sizes,
    });
    expect(html).toMatch(/<img [^>]*width="260" height="130"[^>]*max-width:260px/);
  });

  it('px is capped at the column width', () => {
    const { html } = render([image({ width: { unit: 'px', value: 520 } })], { imageSizes: sizes });
    expect(html).toMatch(/<img [^>]*width="520" height="260"/);
    const inColumn = render([columns([image({ width: { unit: 'px', value: 520 } })], [])], {
      imageSizes: sizes,
    }).html;
    expect(inColumn).toMatch(/<img [^>]*width="247" height="124"/);
  });

  it('alignment sets the cell attribute and the margins', () => {
    const right = render([image({ align: 'right' })]).html;
    expect(right).toContain('<td align="right"');
    expect(right).toContain('margin:0 0 0 auto');
    const left = render([image({ align: 'left' })]).html;
    expect(left).toMatch(/<img [^>]*style="display:block;margin:0;/);
  });

  it('shapes: square has no radius, rounded 8 / 24 px, circle 50 %', () => {
    expect(render([image({ shape: 'square' })]).html).not.toContain('border-radius:8px');
    expect(render([image({ shape: 'rounded' })]).html).toMatch(/<img [^>]*border-radius:8px/);
    expect(render([image({ shape: 'roundedLarge' })]).html).toMatch(/<img [^>]*border-radius:24px/);
    expect(render([image({ shape: 'circle' })]).html).toMatch(/<img [^>]*border-radius:50%/);
  });

  it('the link of an image stays http(s) only', () => {
    const { html } = render([image({ href: 'https://egrant.sk', shape: 'circle' })]);
    expect(html).toMatch(/<a href="https:\/\/egrant\.sk" target="_blank"[^>]*><img /);
  });
});

describe('spacer and right alignment', () => {
  it('a spacer is an empty cell of its height', () => {
    const { html } = render([{ id: 's', type: 'spacer', size: 'large' }]);
    expect(html).toContain('height="48" style="height:48px;line-height:48px;font-size:1px"');
  });

  it('buttons and logos can be right aligned', () => {
    const { html } = render([
      { id: 'b', type: 'button', label: 'Go', url: 'https://e.test', align: 'right' },
      { id: 'l', type: 'logo', align: 'right' },
    ]);
    expect(html).toContain(
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right">',
    );
    expect(html).toMatch(/egrant-logo-email\.png"[^>]*margin:0 0 0 auto/);
  });
});

describe('split container', () => {
  it('is one table row: left cell, gap, divider, gap, right cell with Outlook-safe widths', () => {
    const { html } = render([
      columns(
        [text(para({ text: 'Left' })) as BulkLeafBlock],
        [{ id: 'b', type: 'button', label: 'Go', url: 'https://e.test', align: 'left' }],
        { ratio: '33-67', valign: 'middle', dividerColor: 'purple' },
      ),
    ]);
    // 520 − 2 × 12 − 1 = 495: 165 + 330.
    expect(html).toMatch(
      /<td class="sp-col" width="165" valign="middle" style="width:165px;vertical-align:middle">[\s\S]*Left[\s\S]*<\/td>\s*<td class="sp-gap" width="12"[^>]*>&nbsp;<\/td>\s*<td class="sp-gap sp-line" width="1" bgcolor="#7654FF" style="[^"]*background-color:#7654FF[^"]*">&nbsp;<\/td>\s*<td class="sp-gap" width="12"[^>]*>&nbsp;<\/td>\s*<td class="sp-col sp-col-r" width="330" valign="middle"/,
    );
    expect(html).toContain('>Go</a>');
  });

  it('without a divider the gap is 24 px and the ratio splits 496 px', () => {
    const { html } = render([columns([], [], { divider: false, ratio: '67-33' })]);
    expect(html).not.toContain('sp-line');
    expect(html).toMatch(
      /class="sp-col" width="331"[\s\S]*class="sp-gap" width="24"[\s\S]*class="sp-col sp-col-r" width="165"/,
    );
  });

  it('stacks on phones (left first), hides the gaps; old emails have no such rule', () => {
    const { html } = render([columns([], [])]);
    expect(html).toContain('@media (max-width: 600px)');
    expect(html).toMatch(/\.sp-col \{ display:block !important; width:100% !important;/);
    expect(html).toMatch(/\.sp-gap \{ display:none !important;/);
    expect(html.indexOf('sp-col"')).toBeLessThan(html.indexOf('sp-col sp-col-r'));
    expect(render([text(para({ text: 'x' }))]).html).not.toContain('max-width: 600px');
  });

  it('the text part has the left blocks, then the right ones', () => {
    const { text: plain } = render([
      columns(
        [text(para({ text: 'L' })) as BulkLeafBlock],
        [text(para({ text: 'R' })) as BulkLeafBlock],
      ),
    ]);
    expect(plain.indexOf('L')).toBeLessThan(plain.indexOf('R'));
  });
});

describe('desktop and phone versions', () => {
  const desktop = [text(para({ text: 'Desktop text' }))];
  const phone = [text(para({ text: 'Phone text' }))];

  it('a phone version that follows desktop renders the blocks once', () => {
    const { html } = render(desktop, { phoneBlocks: null });
    expect(html.match(/Desktop text/g)).toHaveLength(1);
    expect(html).not.toContain('sp-phone');
    expect(html).not.toContain('sp-desktop');
  });

  it('a separate phone version: desktop by default, phone hidden from Outlook and shown on phones', () => {
    const { html, text: plain } = render(desktop, { phoneBlocks: phone });
    expect(html).toContain('<div class="sp-desktop">');
    expect(html).toMatch(
      /<!--\[if !mso\]><!-->\s*<div class="sp-phone" style="display:none;max-height:0;overflow:hidden;mso-hide:all">[\s\S]*Phone text[\s\S]*<\/div>\s*<!--<!\[endif\]-->/,
    );
    expect(html.indexOf('Desktop text')).toBeLessThan(html.indexOf('Phone text'));
    expect(html).toMatch(
      /@media \(max-width: 600px\) \{[^}]*\}?[\s\S]*\.sp-desktop \{ display:none !important; \}[\s\S]*\.sp-phone \{ display:block !important; max-height:none !important; overflow:visible !important; \}/,
    );
    // The plain-text part is the desktop version.
    expect(plain).toContain('Desktop text');
    expect(plain).not.toContain('Phone text');
  });

  it('an empty phone version still hides the desktop one on phones', () => {
    const { html } = render(desktop, { phoneBlocks: [] });
    expect(html).toContain('sp-phone');
  });
});
