import { describe, expect, it } from 'vitest';
import { buildEmail } from './layout.js';

describe('buildEmail', () => {
  it('joins paragraphs without a button', () => {
    const m = buildEmail({ to: 'a@example.com', subject: 'S', paragraphs: ['One', 'Two'] });
    expect(m).toEqual({
      to: ['a@example.com'],
      subject: 'S',
      text: 'One\n\nTwo',
      html: '<p>One</p>\n<p>Two</p>',
    });
  });

  it('escapes HTML and renders the button link in both parts', () => {
    const url = 'https://spolu.test/groups/g1/chat?a=1&b="2"';
    const m = buildEmail({
      to: 'a@example.com',
      subject: 'S',
      paragraphs: ['<b>Jana</b>: a & b'],
      button: { label: 'Open <Firma>', url },
    });
    expect(m.html).toContain('<p>&lt;b&gt;Jana&lt;/b&gt;: a &amp; b</p>');
    expect(m.html).not.toContain('<b>');
    expect(m.html).toContain('href="https://spolu.test/groups/g1/chat?a=1&amp;b=&quot;2&quot;"');
    expect(m.html).toContain('Open &lt;Firma&gt;</a>');
    expect(m.html).toContain('style="');
    expect(m.text).toBe(`<b>Jana</b>: a & b\n\nOpen <Firma>: ${url}`);
  });
});
