import { describe, expect, it } from 'vitest';
import { UserLanguages } from '@spolu/shared';
import { plural, serverTexts, type ServerTexts } from './index.js';

/** Every text of a language with sample arguments, as one list of strings. */
function sample(t: ServerTexts): string[] {
  const n = t.notifications;
  const a = t.auth;
  const counts = [1, 2, 3, 4, 5, 11, 21, 22, 25, 101, 102];
  return [
    ...t.email.footer,
    t.bulkEmail.reason,
    t.bulkEmail.unsubscribe,
    a.loginCode.subject('123456'),
    a.loginCode.heading,
    a.loginCode.body,
    a.adminAdded.subject,
    a.adminAdded.greeting('Eva'),
    a.adminAdded.body({ addedBy: 'Jana', email: 'e@x.sk' }),
    a.adminAdded.button,
    a.memberInvited.subject('Firma'),
    a.memberInvited.body({ invitedBy: 'Jana', groupName: 'Firma', email: 'e@x.sk' }),
    a.memberInvited.button,
    a.memberAdded.subject('Firma'),
    a.memberAdded.body({ addedBy: 'Jana', groupName: 'Firma' }),
    a.memberAdded.button,
    a.emailChangeCode.subject('123456'),
    a.emailChangeCode.heading,
    a.emailChangeCode.body('e@x.sk'),
    a.emailChanged.subject,
    a.emailChanged.body('e@x.sk'),
    a.emailChanged.warning,
    t.tickets.created.subject(7, 'Title'),
    t.tickets.created.untitled,
    t.tickets.created.received(7, 'Title'),
    t.tickets.created.followUp,
    t.tickets.created.followUpLink,
    t.tickets.created.button,
    n.sentFile('Jana'),
    n.moved('Done'),
    n.movedGeneric,
    n.assigned('Jana'),
    ...[1, 2, 3].map((d) => n.deadline(d)),
    n.urgent,
    ...(['todo', 'egrant_review', 'client_review', 'done'] as const).map((kind) =>
      n.bucket({ kind, name: 'Firma' }),
    ),
    ...counts.map((c) => n.digestSubject(c, 'Firma')),
    n.digestButton('Firma'),
    n.reminderDue('10:00'),
    n.reminderLine('Call', '10:00'),
    n.deadlineEvent('Call'),
    n.ticketNew(7, 'Firma'),
    n.ticketUnassigned(7),
    ...(['new', 'in_progress', 'resolved'] as const).map((s) => n.ticketStatus(7, s)),
    n.ticketAssigned(7),
    n.ticketUpdated(7),
    ...counts.map((c) => n.ticketTasks(7, c)),
    n.ticketTopic(7),
    n.openTicket,
  ];
}

describe('server texts', () => {
  for (const lang of UserLanguages) {
    it(`${lang}: every text is filled in, with no leftover placeholder`, () => {
      const t = serverTexts(lang);
      expect(() => new Intl.DateTimeFormat(t.intl)).not.toThrow();
      for (const text of sample(t)) {
        expect({ lang, text: text.trim() === '' }).toEqual({ lang, text: false });
        expect(text).not.toMatch(/\bundefined\b|\bnull\b|\$\{|\{\{/);
      }
    });

    it(`${lang}: keeps the brand and the codes`, () => {
      const t = serverTexts(lang);
      expect(t.email.footer.join(' ')).toContain('Help by eGrant');
      expect(t.auth.loginCode.subject('123456')).toContain('123456');
      expect(t.notifications.digestSubject(3, 'Firma')).toContain('Firma');
    });
  }

  it('every language has its own texts (none is a copy of another)', () => {
    const subjects = UserLanguages.map((lang) => serverTexts(lang).auth.adminAdded.subject);
    expect(new Set(subjects).size).toBe(UserLanguages.length);
  });
});

describe('plural', () => {
  it('picks the CLDR form of the language, falling back to other', () => {
    const forms = { one: 'úloha', few: 'úlohy', other: 'úloh' };
    expect([1, 2, 5].map((n) => plural('sk', n, forms))).toEqual(['úloha', 'úlohy', 'úloh']);
    expect(plural('sl', 2, { one: 'a', two: 'b', other: 'c' })).toBe('b');
    expect(plural('en', 2, { one: 'task', other: 'tasks' })).toBe('tasks');
    expect(plural('sk', 1.5, forms)).toBe('úloh');
  });
});
