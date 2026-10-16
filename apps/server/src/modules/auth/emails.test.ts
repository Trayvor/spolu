import { describe, expect, it } from 'vitest';
import {
  adminAddedEmail,
  emailChangeCodeEmail,
  emailChangedNoticeEmail,
  loginCodeEmail,
  memberAddedEmail,
  memberInvitedEmail,
} from './emails.js';
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
    expect(msg.subject).toBe('Your Help by eGrant login code: 123456');
    expect(msg.text).toContain('Your login code is 123456. It is valid for 5 minutes.');
    expect(msg.html).toContain('123456');
  });

  it('is in Slovak', () => {
    const msg = loginCodeEmail('a@example.com', '654321', 'sk');
    expect(msg.subject).toBe('Váš prihlasovací kód do aplikácie Help: 654321');
    expect(msg.text).toContain('Váš prihlasovací kód je 654321. Platí 5 minút.');
  });
});

describe('adminAddedEmail', () => {
  const params = { name: 'Eva', addedBy: 'Jana', loginUrl: 'https://spolu.example/login' };

  it('tells who added the admin and how to log in, in English', () => {
    const msg = adminAddedEmail('eva@example.com', params, 'en');
    expect(msg.to).toEqual(['eva@example.com']);
    expect(msg.subject).toBe('You were added to Help by eGrant');
    expect(msg.text).toContain(
      'Jana added you as an administrator of Help by eGrant. Log in with your email eva@example.com: https://spolu.example/login',
    );
  });

  it('is in Slovak', () => {
    const msg = adminAddedEmail('eva@example.com', params, 'sk');
    expect(msg.subject).toBe('Pridali vás do aplikácie Help');
    expect(msg.text).toContain('Jana vás pridal(a) ako administrátora v aplikácii Help by eGrant.');
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

describe('emailChangeCodeEmail', () => {
  it('puts the code first and names the new address, in English', () => {
    const msg = emailChangeCodeEmail('new@example.com', '123456', 'en');
    expect(msg.to).toEqual(['new@example.com']);
    expect(msg.subject).toBe('Your Help by eGrant email change code: 123456');
    expect(msg.text).toContain('Your code is 123456.');
    expect(msg.text).toContain('new@example.com');
    expect(msg.text).toContain('valid for 5 minutes');
  });

  it('is in Slovak', () => {
    const msg = emailChangeCodeEmail('new@example.com', '654321', 'sk');
    expect(msg.subject).toBe('Kód na zmenu e-mailu v aplikácii Help: 654321');
    expect(msg.text).toContain('Váš kód je 654321.');
    expect(msg.text).toContain('Platí 5 minút.');
  });
});

describe('emailChangedNoticeEmail', () => {
  it('tells the old address the new one, in English', () => {
    const msg = emailChangedNoticeEmail('old@example.com', 'new@example.com', 'en');
    expect(msg.to).toEqual(['old@example.com']);
    expect(msg.subject).toBe('Your Help by eGrant email was changed');
    expect(msg.text).toContain('changed to new@example.com');
  });

  it('is in Slovak and escapes HTML', () => {
    const msg = emailChangedNoticeEmail('old@example.com', '<b>@example.com', 'sk');
    expect(msg.subject).toBe('Váš e-mail v aplikácii Help bol zmenený');
    expect(msg.text).toContain('bol zmenený na <b>@example.com');
    expect(msg.html).toContain('&lt;b&gt;@example.com');
  });
});

describe('memberInvitedEmail', () => {
  const loginUrl = 'https://spolu.example/login?email=eva%40example.com';
  const params = { groupName: 'Firma s.r.o.', invitedBy: 'Jana', loginUrl };

  it('names the group and links the login with the email, in English', () => {
    const msg = memberInvitedEmail('eva@example.com', params, 'en');
    expect(msg.to).toEqual(['eva@example.com']);
    expect(msg.subject).toBe('Invitation to Help by eGrant – Firma s.r.o.');
    expect(msg.text).toContain(
      `Jana invited you to the group Firma s.r.o. in Help by eGrant. Log in with your email eva@example.com: ${loginUrl}`,
    );
  });

  it('is in Slovak', () => {
    const msg = memberInvitedEmail('eva@example.com', params, 'sk');
    expect(msg.subject).toBe('Pozvánka do aplikácie Help – Firma s.r.o.');
    expect(msg.text).toContain(
      `Jana vás pozval(a) do skupiny Firma s.r.o. v aplikácii Help by eGrant. Prihláste sa svojím e-mailom eva@example.com: ${loginUrl}`,
    );
  });
});

describe('memberAddedEmail', () => {
  const groupUrl = 'https://spolu.example/groups/g1';
  const params = { groupName: 'Firma s.r.o.', addedBy: 'Jana', groupUrl };

  it('names the group and links it, in English', () => {
    const msg = memberAddedEmail('eva@example.com', params, 'en');
    expect(msg.subject).toBe('You were added to Firma s.r.o.');
    expect(msg.text).toContain(
      `Jana added you to the group Firma s.r.o. in Help by eGrant: ${groupUrl}`,
    );
  });

  it('is in Slovak', () => {
    const msg = memberAddedEmail('eva@example.com', params, 'sk');
    expect(msg.subject).toBe('Pridali vás do skupiny Firma s.r.o.');
    expect(msg.text).toContain(
      `Jana vás pridal(a) do skupiny Firma s.r.o. v aplikácii Help by eGrant: ${groupUrl}`,
    );
  });
});
