import { describe, expect, it } from 'vitest';
import { UserLanguages, type UserLanguage } from '@spolu/shared';
import {
  adminAddedEmail,
  emailChangeCodeEmail,
  emailChangedNoticeEmail,
  loginCodeEmail,
  memberAddedEmail,
  memberInvitedEmail,
} from './emails.js';
import { pickLanguage } from './language.js';

const PUBLIC_URL = 'https://spolu.example';
const to = (address: string, lang: UserLanguage) => ({ to: address, lang, publicUrl: PUBLIC_URL });

describe('pickLanguage', () => {
  it('takes the first supported primary tag', () => {
    expect(pickLanguage('en-US,en;q=0.9,sk;q=0.8')).toBe('en');
    expect(pickLanguage('de-DE, sk;q=0.7, en;q=0.5')).toBe('sk');
    expect(pickLanguage('EN')).toBe('en');
  });

  it('knows every user language', () => {
    expect(pickLanguage('cs-CZ,cs;q=0.9')).toBe('cs');
    expect(pickLanguage('de-AT, uk-UA;q=0.8')).toBe('uk');
    for (const lang of UserLanguages) expect(pickLanguage(`${lang}-XX`)).toBe(lang);
  });

  it('defaults to Slovak', () => {
    expect(pickLanguage(undefined)).toBe('sk');
    expect(pickLanguage(null)).toBe('sk');
    expect(pickLanguage('')).toBe('sk');
    expect(pickLanguage('de, fr')).toBe('sk');
  });
});

describe('loginCodeEmail', () => {
  it('puts the code in the subject and large in the body, in English', () => {
    const msg = loginCodeEmail(to('a@example.com', 'en'), '123456');
    expect(msg.to).toEqual(['a@example.com']);
    expect(msg.subject).toBe('Your Help by eGrant login code: 123456');
    expect(msg.text).toContain('YOUR LOGIN CODE\n\n123456\n\nIt is valid for 5 minutes.');
    expect(msg.html).toMatch(/<h1[^>]*>123456<\/h1>/);
  });

  it('is in Slovak', () => {
    const msg = loginCodeEmail(to('a@example.com', 'sk'), '654321');
    expect(msg.subject).toBe('Váš prihlasovací kód do aplikácie Help: 654321');
    expect(msg.text).toContain('654321\n\nPlatí 5 minút.');
  });

  it('is in every user language, with the code in the subject', () => {
    const subjects = UserLanguages.map(
      (lang) => loginCodeEmail(to('a@example.com', lang), '111222').subject,
    );
    for (const subject of subjects) expect(subject).toContain('111222');
    expect(new Set(subjects).size).toBe(UserLanguages.length);
  });

  it('has no button (a code email links nowhere)', () => {
    expect(loginCodeEmail(to('a@example.com', 'en'), '123456').html).not.toContain('<a href');
  });
});

describe('adminAddedEmail', () => {
  const params = { name: 'Eva', addedBy: 'Jana', loginUrl: 'https://spolu.example/login' };

  it('tells who added the admin, with a Log in button, in English', () => {
    const msg = adminAddedEmail(to('eva@example.com', 'en'), params);
    expect(msg.to).toEqual(['eva@example.com']);
    expect(msg.subject).toBe('You were added to Help by eGrant');
    expect(msg.text).toContain(
      'Jana added you as an administrator of Help by eGrant. Log in with your email eva@example.com.',
    );
    expect(msg.text).toContain('Log in: https://spolu.example/login');
  });

  it('is in Slovak', () => {
    const msg = adminAddedEmail(to('eva@example.com', 'sk'), params);
    expect(msg.subject).toBe('Pridali vás do aplikácie Help');
    expect(msg.text).toContain('Jana vás pridal(a) ako administrátora v aplikácii Help by eGrant.');
    expect(msg.text).toContain('Prihlásiť sa: https://spolu.example/login');
  });

  it('escapes HTML in names and shows markup in them as written', () => {
    const msg = adminAddedEmail(to('eva@example.com', 'en'), {
      ...params,
      name: '<b>Eva</b> **x** {{name}}',
      addedBy: 'Jana & "<script>"',
    });
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).not.toContain('<b>Eva</b>');
    expect(msg.html).toContain('Jana &amp; &quot;&lt;script&gt;&quot;');
    expect(msg.html).toContain('&lt;b&gt;Eva&lt;/b&gt; **x** {{name}}');
  });
});

describe('emailChangeCodeEmail', () => {
  it('shows the code and names the new address, in English', () => {
    const msg = emailChangeCodeEmail(to('new@example.com', 'en'), '123456');
    expect(msg.to).toEqual(['new@example.com']);
    expect(msg.subject).toBe('Your Help by eGrant email change code: 123456');
    expect(msg.html).toMatch(/<h1[^>]*>123456<\/h1>/);
    expect(msg.text).toContain('new@example.com');
    expect(msg.text).toContain('valid for 5 minutes');
  });

  it('is in Slovak', () => {
    const msg = emailChangeCodeEmail(to('new@example.com', 'sk'), '654321');
    expect(msg.subject).toBe('Kód na zmenu e-mailu v aplikácii Help: 654321');
    expect(msg.text).toContain('654321');
    expect(msg.text).toContain('Platí 5 minút.');
  });
});

describe('emailChangedNoticeEmail', () => {
  it('tells the old address the new one, in English', () => {
    const msg = emailChangedNoticeEmail(to('old@example.com', 'en'), 'new@example.com');
    expect(msg.to).toEqual(['old@example.com']);
    expect(msg.subject).toBe('Your Help by eGrant email was changed');
    expect(msg.text).toContain('changed to new@example.com');
  });

  it('is in Slovak and escapes HTML', () => {
    const msg = emailChangedNoticeEmail(to('old@example.com', 'sk'), '<b>@example.com');
    expect(msg.subject).toBe('Váš e-mail v aplikácii Help bol zmenený');
    expect(msg.text).toContain('bol zmenený na <b>@example.com');
    expect(msg.html).toContain('&lt;b&gt;@example.com');
  });
});

describe('memberInvitedEmail', () => {
  const loginUrl = 'https://spolu.example/login?email=eva%40example.com';
  const params = { groupName: 'Firma s.r.o.', invitedBy: 'Jana', loginUrl };

  it('names the group and links the login with the email, in English', () => {
    const msg = memberInvitedEmail(to('eva@example.com', 'en'), params);
    expect(msg.to).toEqual(['eva@example.com']);
    expect(msg.subject).toBe('Invitation to Help by eGrant – Firma s.r.o.');
    expect(msg.text).toContain(
      'Jana invited you to the group Firma s.r.o. in Help by eGrant. Log in with your email eva@example.com.',
    );
    expect(msg.text).toContain(`Log in: ${loginUrl}`);
  });

  it('is in Slovak', () => {
    const msg = memberInvitedEmail(to('eva@example.com', 'sk'), params);
    expect(msg.subject).toBe('Pozvánka do aplikácie Help – Firma s.r.o.');
    expect(msg.text).toContain(
      'Jana vás pozval(a) do skupiny Firma s.r.o. v aplikácii Help by eGrant. Prihláste sa svojím e-mailom eva@example.com.',
    );
  });
});

describe('memberAddedEmail', () => {
  const groupUrl = 'https://spolu.example/groups/g1';
  const params = { groupName: 'Firma s.r.o.', addedBy: 'Jana', groupUrl };

  it('names the group and links it, in English', () => {
    const msg = memberAddedEmail(to('eva@example.com', 'en'), params);
    expect(msg.subject).toBe('You were added to Firma s.r.o.');
    expect(msg.text).toContain('Jana added you to the group Firma s.r.o. in Help by eGrant.');
    expect(msg.text).toContain(`Open the group: ${groupUrl}`);
  });

  it('is in Slovak', () => {
    const msg = memberAddedEmail(to('eva@example.com', 'sk'), params);
    expect(msg.subject).toBe('Pridali vás do skupiny Firma s.r.o.');
    expect(msg.text).toContain(
      'Jana vás pridal(a) do skupiny Firma s.r.o. v aplikácii Help by eGrant.',
    );
  });
});
