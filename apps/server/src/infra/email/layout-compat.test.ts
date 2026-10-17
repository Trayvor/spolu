import { describe, expect, it } from 'vitest';
import { buildEmail } from './layout.js';

/**
 * Phase 31 compatibility: system emails render byte for byte as before the bulk email builder
 * v2. The snapshot was recorded with the Phase 26 renderer; never update it to make it pass.
 */
describe('system email renders as before', () => {
  it('logo, heading, code, paragraphs with links and **, button, footer', () => {
    const mail = buildEmail({
      to: 'a@example.com',
      lang: 'sk',
      publicUrl: 'https://spolu.test',
      subject: 'Kód {{name}}',
      code: '123456',
      paragraphs: ['Skupina **Alfa** & <beta>', 'Riadok\nďalší https://egrant.sk/x.'],
      button: { label: 'Otvoriť', url: 'https://spolu.test/login' },
    });
    expect(mail.html).toMatchSnapshot('html');
    expect(mail.text).toMatchSnapshot('text');
  });
});
