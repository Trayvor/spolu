import { describe, expect, it } from 'vitest';
import { adminAddedEmail, loginCodeEmail } from './emails.js';
import { pickLanguage } from './language.js';

describe('pickLanguage', () => {
  it('takes the first supported primary tag', () => {
    expect(pickLanguage('en-US,en;q=0.9,sk;q=0.8')).toBe('en');
    expect(pickLanguage('de-DE, sk;q=0.7, en;q=0.5')).toBe('sk');
    expect(pickLanguage('EN')).toBe('en');
  });

  it('defaults to Slovak', () => {
    expect(pickLanguage(undefined)).toBe('sk');
    expect(pickLanguage(null)).toBe('sk');
    expect(pickLanguage('')).toBe('sk');
    expect(pickLanguage('de, fr')).toBe('sk');
  });
});

describe('loginCodeEmail', () => {
  it('puts the code in the subject and the body, in English', () => {
    const msg = loginCodeEmail('a@example.com', '123456', 'en');
    expect(msg.to).toEqual(['a@example.com']);
    expect(msg.subject).toBe('Your Spolu login code: 123456');
    expect(msg.text).toContain('Your login code is 123456. It is valid for 5 minutes.');
    expect(msg.html).toContain('123456');
  });

  it('is in Slovak', () => {
    const msg = loginCodeEmail('a@example.com', '654321', 'sk');
    expect(msg.subject).toBe('Váš prihlasovací kód do Spolu: 654321');
    expect(msg.text).toContain('Váš prihlasovací kód je 654321. Platí 5 minút.');
  });
});

describe('adminAddedEmail', () => {
  const params = { name: 'Eva', addedBy: 'Jana', loginUrl: 'https://spolu.example/login' };

  it('tells who added the admin and how to log in, in English', () => {
    const msg = adminAddedEmail('eva@example.com', params, 'en');
    expect(msg.to).toEqual(['eva@example.com']);
    expect(msg.subject).toBe('You were added to Spolu');
    expect(msg.text).toContain(
      'Jana added you as an administrator of Spolu by eGrant. Log in with your email eva@example.com: https://spolu.example/login',
    );
  });

  it('is in Slovak', () => {
    const msg = adminAddedEmail('eva@example.com', params, 'sk');
    expect(msg.subject).toBe('Pridali vás do Spolu');
    expect(msg.text).toContain('Jana vás pridal(a) ako administrátora v Spolu by eGrant.');
  });

  it('escapes HTML in names', () => {
    const msg = adminAddedEmail(
      'eva@example.com',
      { ...params, name: '<b>Eva</b>', addedBy: 'Jana & "<script>"' },
      'en',
    );
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).not.toContain('<b>Eva</b>');
    expect(msg.html).toContain('Jana &amp; &quot;&lt;script&gt;&quot;');
    expect(msg.html).toContain('&lt;b&gt;Eva&lt;/b&gt;');
  });
});
