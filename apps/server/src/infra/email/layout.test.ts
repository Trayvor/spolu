import { describe, expect, it } from 'vitest';
import { UserLanguages } from '@spolu/shared';
import { serverTexts } from '../i18n/index.js';
import { buildEmail } from './layout.js';

const base = { to: 'a@example.com', lang: 'en' as const, publicUrl: 'https://spolu.test/' };

describe('buildEmail', () => {
  it('renders the one email design: logo, heading, texts and the system footer', () => {
    const m = buildEmail({ ...base, subject: 'S', paragraphs: ['One', 'Two'] });
    expect(m.to).toEqual(['a@example.com']);
    expect(m.subject).toBe('S');
    expect(m.html).toContain('<html xmlns="http://www.w3.org/1999/xhtml" lang="en">');
    expect(m.html).toContain('src="https://spolu.test/brand/egrant-logo-email.png"');
    expect(m.html).toMatch(/<h1[^>]*>S<\/h1>/);
    expect(m.html).toContain('>One</p>');
    expect(m.html).toContain('>Two</p>');
    expect(m.html).toContain('class="sp-card"');
    expect(m.text).toBe(
      ['S', 'One', 'Two', '---', serverTexts('en').email.footer.join('\n')].join('\n\n'),
    );
  });

  it('has no unsubscribe link, no tracking and no image but the logo', () => {
    const m = buildEmail({
      ...base,
      subject: 'S',
      paragraphs: ['One'],
      button: { label: 'Open', url: 'https://spolu.test/x' },
    });
    expect(m.html.match(/<img /g)).toHaveLength(1);
    expect(m.html.match(/<a href/g)).toHaveLength(1);
    expect(m.html).not.toMatch(/unsubscribe/i);
    expect(m).not.toHaveProperty('headers');
  });

  it('escapes HTML, keeps markup literal and renders the button in both parts', () => {
    const url = 'https://spolu.test/groups/g1/chat?a=1&b="2"';
    const m = buildEmail({
      ...base,
      subject: 'S',
      heading: 'Hi <Jana>',
      paragraphs: ['<b>Jana</b>: a & b **c** {{name}}'],
      button: { label: 'Open <Firma>', url },
    });
    expect(m.html).toContain('&lt;b&gt;Jana&lt;/b&gt;: a &amp; b **c** {{name}}');
    expect(m.html).not.toContain('<b>');
    expect(m.html).toContain('Hi &lt;Jana&gt;</h1>');
    expect(m.html).toContain('href="https://spolu.test/groups/g1/chat?a=1&amp;b=&quot;2&quot;"');
    expect(m.html).toContain('Open &lt;Firma&gt;</a>');
    expect(m.text).toContain(`<b>Jana</b>: a & b **c** {{name}}\n\nOpen <Firma>: ${url}`);
  });

  it('shows a code as a second heading', () => {
    const m = buildEmail({
      ...base,
      subject: 'S',
      heading: 'Your code',
      code: '123456',
      paragraphs: [],
    });
    expect(m.text.startsWith('YOUR CODE\n\n123456\n\n---')).toBe(true);
  });

  it('writes the footer in the recipient language', () => {
    for (const lang of UserLanguages) {
      const m = buildEmail({ ...base, lang, subject: 'S', paragraphs: ['x'] });
      expect(m.html).toContain(`lang="${lang}"`);
      for (const line of serverTexts(lang).email.footer) expect(m.text).toContain(line);
    }
  });
});
