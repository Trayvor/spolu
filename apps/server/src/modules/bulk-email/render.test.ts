import { describe, expect, it } from 'vitest';
import type { BulkBlock } from '@spolu/shared';
import { bulkFooter } from './texts.js';
import { LOGO_PATH, imageUrl, renderCampaign } from './render.js';

const PUBLIC_URL = 'https://spolu.test';
const UNSUB = 'https://spolu.test/unsubscribe/u1.c1.sig';

function render(
  blocks: BulkBlock[],
  opts: Partial<Parameters<typeof renderCampaign>[0]> = {},
): { html: string; text: string } {
  return renderCampaign({
    subject: 'Novinky',
    preheader: '',
    blocks,
    recipient: { name: 'Jana', language: 'sk' },
    unsubscribeHref: UNSUB,
    publicUrl: PUBLIC_URL,
    ...opts,
  });
}

const heading = (text: string, align: 'left' | 'center' = 'left'): BulkBlock => ({
  id: 'h',
  type: 'heading',
  text,
  align,
});
const textBlock = (text: string, align: 'left' | 'center' = 'left'): BulkBlock => ({
  id: 't',
  type: 'text',
  text,
  align,
});

describe('imageUrl and LOGO_PATH', () => {
  it('builds the public image URL and strips a trailing slash of the public URL', () => {
    expect(imageUrl('https://spolu.test/', 'abc')).toBe(
      'https://spolu.test/api/bulk-email/images/abc',
    );
    expect(LOGO_PATH).toBe('/brand/egrant-logo-email.png');
  });
});

describe('renderCampaign: security', () => {
  it('escapes <script> and quotes in every text field', () => {
    const evil = `<script>alert("x")</script>'`;
    const { html } = render(
      [
        heading(evil),
        textBlock(evil),
        { id: 'i', type: 'image', imageId: 'img"1', alt: evil },
        { id: 'b', type: 'button', label: evil, url: 'https://e.test/?a="1"&b=<2>', align: 'left' },
      ],
      { subject: evil, preheader: evil },
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert("x")');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;');
    expect(html).toContain('href="https://e.test/?a=&quot;1&quot;&amp;b=&lt;2&gt;"');
    expect(html).toContain('alt="&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;"');
    expect(html).toContain('/api/bulk-email/images/img%221"');
  });

  it('never links a javascript: or data: URL written in text', () => {
    const { html } = render([textBlock('javascript:alert(1) data:text/html,x')]);
    expect(html).not.toMatch(/href="(javascript|data):/);
  });

  it('drops a button or image link whose URL is not safe (defence in depth)', () => {
    const { html } = render([
      { id: 'b', type: 'button', label: 'Go', url: 'javascript:alert(1)', align: 'left' },
      {
        id: 'i',
        type: 'image',
        imageId: 'x',
        alt: 'A',
        href: 'javascript:alert(1)',
      } as BulkBlock,
    ]);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Go');
  });

  it('keeps a mailto: button', () => {
    const { html, text } = render([
      { id: 'b', type: 'button', label: 'Write', url: 'mailto:info@egrant.sk', align: 'left' },
    ]);
    expect(html).toContain('href="mailto:info@egrant.sk"');
    expect(text).toContain('Write: mailto:info@egrant.sk');
  });

  it('has no script, style attribute expressions, forms or iframes', () => {
    const { html } = render([heading('a'), textBlock('b')]);
    expect(html).not.toMatch(/<(script|form|iframe|object|embed|input)\b/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});

describe('renderCampaign: personalization', () => {
  it('replaces {{name}} in heading and text, escaped', () => {
    const { html, text } = render(
      [heading('Ahoj {{name}}'), textBlock('Milá {{name}}, ďakujeme.')],
      {
        recipient: { name: 'Jana <b>&', language: 'sk' },
      },
    );
    expect(html).toContain('Ahoj Jana &lt;b&gt;&amp;');
    expect(html).toContain('Milá Jana &lt;b&gt;&amp;, ďakujeme.');
    expect(html).not.toContain('{{name}}');
    expect(text).toContain('Milá Jana <b>&, ďakujeme.');
  });

  it('does not format markup inside the name', () => {
    const { html } = render([textBlock('Hi {{name}}')], {
      recipient: { name: '**x** https://evil.test', language: 'en' },
    });
    expect(html).not.toContain('<strong>x</strong>');
    expect(html).not.toContain('href="https://evil.test"');
  });

  it('leaves a lone {{ and other placeholders as written', () => {
    const { html } = render([textBlock('a {{ b {{email}} {{name')]);
    expect(html).toContain('a {{ b {{email}} {{name');
  });

  it('does not replace {{name}} in a button label or an alt', () => {
    const { html } = render([
      { id: 'b', type: 'button', label: '{{name}}', url: 'https://e.test', align: 'left' },
    ]);
    expect(html).toContain('>{{name}}</a>');
  });
});

describe('renderCampaign: blocks', () => {
  it('text: a blank line makes paragraphs, a single newline a line break', () => {
    const { html } = render([textBlock('One\nline two\n\n\nTwo')]);
    expect(html.match(/<p\b/g)).toHaveLength(2);
    expect(html).toContain('One<br />line two');
  });

  it('text: **bold** becomes <strong>', () => {
    const { html } = render([textBlock('a **bold** b ** c')]);
    expect(html).toMatch(/<strong[^>]*>bold<\/strong>/);
    expect(html).toContain(' b ** c');
  });

  it('text: http(s) URLs become links without trailing punctuation', () => {
    const { html } = render([textBlock('See https://egrant.sk/a?b=1&c=2. Or http://x.test!')]);
    expect(html).toMatch(
      /<a href="https:\/\/egrant\.sk\/a\?b=1&amp;c=2"[^>]*>https:\/\/egrant\.sk\/a\?b=1&amp;c=2<\/a>\./,
    );
    expect(html).toMatch(/<a href="http:\/\/x\.test"[^>]*>http:\/\/x\.test<\/a>!/);
  });

  it('heading and text follow their alignment', () => {
    const { html } = render([heading('H', 'center'), textBlock('T', 'center')]);
    expect(html).toMatch(/<h1[^>]*text-align:center[^>]*>H<\/h1>/);
    expect(html).toMatch(/<p[^>]*text-align:center[^>]*>T<\/p>/);
  });

  it('image renders width, alt, display:block, border 0 and its link', () => {
    const { html } = render([
      { id: 'i', type: 'image', imageId: 'abc', alt: 'Photo', href: 'https://egrant.sk' },
    ]);
    expect(html).toMatch(
      /<a href="https:\/\/egrant\.sk"[^>]*><img src="https:\/\/spolu\.test\/api\/bulk-email\/images\/abc"[^>]*width="520"[^>]*alt="Photo"[^>]*style="[^"]*display:block[^"]*border:0/,
    );
  });

  it('image uses its own width when smaller than the column, with the height', () => {
    const { html } = render([{ id: 'i', type: 'image', imageId: 'abc', alt: 'A' }], {
      imageSizes: new Map([['abc', { width: 300, height: 150 }]]),
    });
    expect(html).toMatch(/<img [^>]*width="300" height="150"/);
    expect(html).not.toMatch(/<a [^>]*><img/);
  });

  it('a large image is scaled to the column width with its ratio', () => {
    const { html } = render([{ id: 'i', type: 'image', imageId: 'abc', alt: 'A' }], {
      imageSizes: new Map([['abc', { width: 1200, height: 600 }]]),
    });
    expect(html).toMatch(/<img [^>]*width="520" height="260"/);
  });

  it('button is a table cell with a background colour and a padded link', () => {
    const { html } = render([
      { id: 'b', type: 'button', label: 'Open', url: 'https://egrant.sk', align: 'center' },
    ]);
    expect(html).toMatch(
      /<td align="center"[^>]*>\s*<table role="presentation"[^>]*>\s*<tr>\s*<td [^>]*bgcolor="#141414"[^>]*>\s*<a href="https:\/\/egrant\.sk"[^>]*style="[^"]*padding:[^"]*"[^>]*>Open<\/a>/,
    );
  });

  it('divider is a 1px line', () => {
    const { html } = render([{ id: 'd', type: 'divider' }]);
    expect(html).toContain('background-color:#E3DEDA');
  });

  it('logo uses LOGO_PATH on publicUrl', () => {
    const { html } = render([{ id: 'l', type: 'logo', align: 'center' }]);
    expect(html).toMatch(
      /<img src="https:\/\/spolu\.test\/brand\/egrant-logo-email\.png" width="180"[^>]*alt="eGrant"/,
    );
  });
});

describe('renderCampaign: document', () => {
  it('html has an XHTML doctype, role=presentation tables 600 wide and the 620px media rule', () => {
    const { html } = render([heading('H')]);
    expect(html.startsWith('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"')).toBe(
      true,
    );
    expect(html).toMatch(/<table role="presentation"[^>]*width="600"/);
    expect(html).toContain('@media (max-width: 620px)');
    expect(html.match(/@media/g)).toHaveLength(1);
    expect(html).toContain('<html xmlns="http://www.w3.org/1999/xhtml" lang="sk">');
    expect(html).toContain('<title>Novinky</title>');
  });

  it('preheader is hidden text at the top of the body', () => {
    const { html } = render([heading('H')], { preheader: 'Read this' });
    const body = html.slice(html.indexOf('<body'));
    const pre = body.indexOf('Read this');
    expect(pre).toBeGreaterThan(-1);
    expect(pre).toBeLessThan(body.indexOf('<table'));
    expect(body.slice(0, pre)).toMatch(/display:none/);
  });

  it('no preheader, no hidden block', () => {
    const { html } = render([heading('H')]);
    expect(html).not.toContain('display:none');
  });

  it('footer is Slovak for sk, English for en, with unsubscribeHref', () => {
    const sk = render([heading('H')]).html;
    expect(sk).toContain(bulkFooter('sk').reason);
    expect(sk).toContain(`href="${UNSUB}"`);
    expect(sk).toContain(`>${bulkFooter('sk').unsubscribe}</a>`);
    const en = render([heading('H')], {
      recipient: { name: 'J', language: 'en' },
      unsubscribeHref: '{unsubscribe:https://spolu.test/unsubscribe/x}',
    }).html;
    expect(en).toContain(bulkFooter('en').reason);
    expect(en).toContain('href="{unsubscribe:https://spolu.test/unsubscribe/x}"');
    expect(en).toContain(`>${bulkFooter('en').unsubscribe}</a>`);
    expect(bulkFooter('en').reason).toBe(
      'You get this email because you have an account in Help by eGrant.',
    );
  });

  it('text part: heading in capitals, button as "label: url", image as [alt], unsubscribe line last', () => {
    const { text } = render(
      [
        heading('Novinky pre {{name}}'),
        textBlock('Prvý **odsek**.\n\nDruhý https://egrant.sk.'),
        { id: 'i', type: 'image', imageId: 'x', alt: 'Fotka' },
        { id: 'd', type: 'divider' },
        { id: 'b', type: 'button', label: 'Otvoriť', url: 'https://egrant.sk', align: 'left' },
        { id: 'l', type: 'logo', align: 'left' },
      ],
      { preheader: 'Skryté' },
    );
    expect(text).toBe(
      [
        'NOVINKY PRE JANA',
        'Prvý odsek.',
        'Druhý https://egrant.sk.',
        '[Fotka]',
        '---',
        'Otvoriť: https://egrant.sk',
        '---',
        `${bulkFooter('sk').reason}\n${bulkFooter('sk').unsubscribe}: ${UNSUB}`,
      ].join('\n\n'),
    );
  });

  it('is the same for the same input (stable for idempotent sends)', () => {
    const blocks = [heading('H {{name}}'), textBlock('x')];
    expect(render(blocks)).toEqual(render(blocks));
  });
});
