import { describe, expect, it } from 'vitest';
import { UserLanguages, type NotificationKind } from '@spolu/shared';
import { buildPushPayload } from './push-content.js';
import { formatReminderTime, texts } from './texts.js';

const chat = {
  channelId: 'c1',
  messageId: 'm1',
  groupId: 'g1',
  authorName: 'Jana',
  excerpt: 'Ahoj',
};
const base = {
  kind: 'chat.message',
  payload: chat,
  groupName: 'Firma',
  taskTitle: null,
  parentId: null,
  lang: 'sk',
} as const;
const task = { taskId: 't1', groupId: 'g1', title: 'Report', actorName: 'Jana' };

describe('buildPushPayload reminder', () => {
  const reminder = {
    subjectKind: 'knowledge',
    subjectId: 'k1',
    groupId: 'g1',
    title: 'Call the bank',
    at: '2026-10-25T09:00:00Z',
  };
  const r = { ...base, kind: 'reminder.due', payload: reminder } as const;
  it('reminder push has title · group, knowledge URL and tag', () => {
    expect(buildPushPayload({ ...r, lang: 'en' })).toMatchObject({
      title: 'Call the bank · Firma',
      url: '/groups/g1/knowledge?k=k1',
      tag: 'knowledge:k1',
    });
  });
  it('reminder push body uses Bratislava time across the DST change', () => {
    expect(buildPushPayload({ ...r, lang: 'en' }).body).toContain('10:00');
    const before = { ...reminder, at: '2026-10-24T09:00:00Z' };
    expect(buildPushPayload({ ...r, lang: 'en', payload: before }).body).toContain('11:00');
  });
  it('a missing or invalid time gives an empty time, not an error', () => {
    expect(formatReminderTime(undefined, 'en')).toBe('');
    expect(formatReminderTime('nonsense', 'sk')).toBe('');
    const bad = { ...reminder, at: 'nonsense' };
    expect(buildPushPayload({ ...r, payload: bad }).body).toBe('Pripomienka na ');
  });
  it("a project event's reminder (F15) opens the event on the Prehľad tab", () => {
    const payload = {
      subjectKind: 'event',
      subjectId: 'ev1',
      groupId: 'g1',
      title: 'Kickoff',
      at: '2026-12-01T08:00:00Z',
    };
    const push = buildPushPayload({ ...base, kind: 'reminder.due', payload, lang: 'en' });
    expect(push).toMatchObject({
      title: 'Kickoff · Firma',
      url: '/groups/g1/overview?event=ev1',
      tag: 'event:ev1',
    });
  });
  it('a finance contract reminder opens the finance tab and says when the contract ends', () => {
    const payload = {
      subjectKind: 'finance',
      subjectId: 'f1',
      groupId: 'g1',
      title: 'Zmluva 2026',
      at: '2026-12-01T08:00:00Z',
      endsOn: '2026-12-31',
    };
    const push = buildPushPayload({ ...base, kind: 'reminder.due', payload, lang: 'en' });
    expect(push).toMatchObject({
      title: 'Zmluva 2026 · Firma',
      url: '/groups/g1/finance?item=f1',
      tag: 'finance:f1',
    });
    expect(push.body).toMatch(/^Contract ends on .*31.*Dec.*2026/);
    // Never money in a push.
    expect(JSON.stringify(push)).not.toMatch(/€|EUR/);
  });
  it("an expense's reminder (Phase 32 E) opens /finance, names a salary's admin and says when it is due", () => {
    const payload = {
      subjectKind: 'finance',
      subjectId: 'e1',
      groupId: null,
      title: 'Eva Nováková',
      at: '2026-10-30T08:00:00Z',
      dueOn: '2026-10-31',
      salary: true,
    };
    const push = buildPushPayload({
      ...base,
      groupName: '',
      kind: 'reminder.due',
      payload,
      lang: 'en',
    });
    expect(push).toMatchObject({
      title: 'Salary: Eva Nováková',
      url: '/finance?item=e1',
      tag: 'finance:e1',
    });
    expect(push.body).toMatch(/^Expense due on .*31.*Oct.*2026/);
    const other = { ...payload, title: 'Server', salary: undefined };
    expect(
      buildPushPayload({ ...base, groupName: '', kind: 'reminder.due', payload: other, lang: 'sk' })
        .title,
    ).toBe('Server');
    expect(JSON.stringify(push)).not.toMatch(/€|EUR/);
  });
  it('a reminder of a contract of several clients (Phase 32 E) opens /finance', () => {
    const payload = {
      subjectKind: 'finance',
      subjectId: 'c1',
      groupId: null,
      title: 'Spoločný grant',
      at: '2026-12-01T08:00:00Z',
      endsOn: '2026-12-31',
    };
    const push = buildPushPayload({
      ...base,
      groupName: '',
      kind: 'reminder.due',
      payload,
      lang: 'en',
    });
    expect(push).toMatchObject({ title: 'Spoločný grant', url: '/finance?item=c1' });
    expect(push.body).toMatch(/^Contract ends on/);
  });
  it('sk body reads "Pripomienka na …"', () => {
    expect(buildPushPayload({ ...r, lang: 'sk' }).body).toMatch(/^Pripomienka na .*10:00/);
  });

  describe('task reminders', () => {
    const at = '2026-10-16T12:00:00Z'; // 14:00 in Bratislava (summer time)
    const payload = {
      subjectKind: 'task',
      subjectId: 't1',
      taskId: 't1',
      groupId: 'g1',
      title: 'Old title',
      at,
    };
    const t = { ...base, kind: 'reminder.due', payload, lang: 'en' } as const;
    const onTime = new Date('2026-10-16T12:00:30Z');

    it('a task reminder push has the task URL and tag task:<id>', () => {
      expect(buildPushPayload({ ...t, taskTitle: 'Fix the budget', now: onTime })).toEqual({
        title: 'Fix the budget · Firma',
        body: 'Reminder for 14:00',
        url: '/groups/g1/tasks/t1',
        tag: 'task:t1',
        renotify: true,
        actions: [{ action: 'done', title: 'Done', taskId: 't1' }],
      });
      // Without the current title, the one recorded with the event.
      expect(buildPushPayload({ ...t, now: onTime }).title).toBe('Old title · Firma');
    });

    it('on time the body is "Reminder for 14:00"; ten minutes late it names the day', () => {
      expect(buildPushPayload({ ...t, now: onTime }).body).toBe('Reminder for 14:00');
      const late = new Date('2026-10-16T12:10:00Z');
      expect(buildPushPayload({ ...t, now: late }).body).toBe(
        `Reminder for ${formatReminderTime(at, 'en')}`,
      );
      expect(buildPushPayload({ ...t, lang: 'sk', now: onTime }).body).toBe('Pripomienka na 14:00');
    });
  });
});

describe('buildPushPayload chat', () => {
  it('plain message', () => {
    expect(buildPushPayload(base)).toEqual({
      title: 'Firma',
      body: 'Jana: Ahoj',
      url: '/groups/g1/chat?message=m1',
      tag: 'chat:c1',
      actions: [
        {
          action: 'reply',
          title: 'Odpovedať',
          placeholder: 'Napíšte odpoveď…',
          channelId: 'c1',
          parentId: null,
          url: '/groups/g1/chat?message=m1&c=c1&reply=1',
        },
      ],
    });
  });
  it('mention reads like a message', () => {
    expect(buildPushPayload({ ...base, kind: 'chat.mention' }).body).toBe('Jana: Ahoj');
  });
  it('thread reply', () => {
    expect(buildPushPayload({ ...base, kind: 'chat.thread_reply', parentId: 'r1' })).toMatchObject({
      url: '/groups/g1/chat?thread=r1&message=m1',
      tag: 'thread:r1',
    });
  });
  it('task chat', () => {
    expect(
      buildPushPayload({ ...base, payload: { ...chat, taskId: 't1' }, taskTitle: 'Report' }),
    ).toMatchObject({
      title: 'Report · Firma',
      url: '/groups/g1/tasks/t1?tab=chat&message=m1&c=c1',
      tag: 'chat:c1',
    });
    expect(
      buildPushPayload({
        ...base,
        payload: { ...chat, taskId: 't1' },
        taskTitle: 'Report',
        parentId: 'r1',
      }).url,
    ).toBe('/groups/g1/tasks/t1?tab=chat&thread=r1&message=m1&c=c1');
  });
  it('encodes ids in urls', () => {
    expect(buildPushPayload({ ...base, payload: { ...chat, messageId: 'a b' } }).url).toBe(
      '/groups/g1/chat?message=a%20b',
    );
  });
  it('cuts long excerpts to 120 characters plus an ellipsis', () => {
    const body = buildPushPayload({ ...base, payload: { ...chat, excerpt: 'x'.repeat(140) } }).body;
    expect(body).toBe(`Jana: ${'x'.repeat(120)}…`);
  });
  it('cuts by code points so emoji never split', () => {
    const body = buildPushPayload({
      ...base,
      payload: { ...chat, excerpt: '😀'.repeat(130) },
    }).body;
    expect(body).toBe(`Jana: ${'😀'.repeat(120)}…`);
  });
  it('empty excerpt means a file', () => {
    const p = { ...chat, excerpt: '' };
    expect(buildPushPayload({ ...base, payload: p }).body).toBe('Jana poslal(a) súbor');
    expect(buildPushPayload({ ...base, payload: p, lang: 'en' }).body).toBe('Jana sent a file');
  });
});

describe('buildPushPayload tasks', () => {
  const t = { ...base, taskTitle: 'Report' };
  const url = '/groups/g1/tasks/t1';
  it('moved', () => {
    const en = { ...t, lang: 'en', kind: 'task.moved' } as const;
    expect(
      buildPushPayload({
        ...en,
        payload: { ...task, toBucket: { kind: 'egrant_review', name: null } },
      }),
    ).toEqual({
      title: 'Report · Firma',
      body: 'Moved to the “eGrant review” column',
      url,
      tag: 'task:t1',
    });
    expect(
      buildPushPayload({
        ...en,
        payload: { ...task, toBucket: { kind: 'client_review', name: 'Firma' } },
      }).body,
    ).toBe('Moved to the “Firma review” column');
    expect(
      buildPushPayload({
        ...t,
        kind: 'task.moved',
        payload: { ...task, toBucket: { kind: 'egrant_review', name: null } },
      }).body,
    ).toBe('Presunuté do stĺpca „Kontroluje eGrant“');
  });
  it('moved without a usable toBucket falls back to a generic body', () => {
    const m = { ...t, kind: 'task.moved' } as const;
    expect(buildPushPayload({ ...m, payload: task }).body).toBe('Úloha presunutá');
    expect(buildPushPayload({ ...m, lang: 'en', payload: { ...task, toBucket: 'x' } }).body).toBe(
      'Task moved',
    );
    expect(
      buildPushPayload({ ...m, payload: { ...task, toBucket: { kind: 'nope', name: null } } }).body,
    ).toBe('Úloha presunutá');
  });
  it('assigned', () => {
    const a = { ...t, kind: 'task.assigned', payload: task } as const;
    expect(buildPushPayload({ ...a, lang: 'en' }).body).toBe('Jana assigned you to this task');
    expect(buildPushPayload(a).body).toBe('Jana vás priradil(a) k úlohe');
  });
  it('deadline', () => {
    const d = (daysLeft: number, lang: 'sk' | 'en') =>
      buildPushPayload({ ...t, lang, kind: 'task.deadline', payload: { ...task, daysLeft } }).body;
    expect(d(2, 'en')).toBe('Due in 2 days');
    expect(d(3, 'en')).toBe('Due in 3 days');
    expect(d(2, 'sk')).toBe('Termín o 2 dni');
    expect(d(3, 'sk')).toBe('Termín o 3 dni');
    expect(d(5, 'sk')).toBe('Termín o 5 dní');
    expect(d(1, 'en')).toBe('Due tomorrow');
    expect(d(1, 'sk')).toBe('Termín zajtra');
  });
  it('urgent', () => {
    const u = { ...t, kind: 'task.urgent', payload: task } as const;
    expect(buildPushPayload({ ...u, lang: 'en' }).body).toBe('Urgent: still open');
    expect(buildPushPayload(u).body).toBe('Urgentné: stále otvorené');
  });
  it('falls back to the payload title', () => {
    expect(
      buildPushPayload({ ...base, taskTitle: null, kind: 'task.urgent', payload: task }).title,
    ).toBe('Report · Firma');
  });
});

describe('texts', () => {
  it('bucket names reuse the board names', () => {
    expect(texts('en').bucket({ kind: 'todo', name: null })).toBe('To do');
    expect(texts('en').bucket({ kind: 'done', name: null })).toBe('Done');
    expect(texts('sk').bucket({ kind: 'client_review', name: 'Firma' })).toBe('Kontroluje Firma');
    expect(texts('sk').bucket({ kind: 'done', name: null })).toBe('Hotové');
    expect(texts('en').bucket({ kind: 'custom', name: 'QA' })).toBe('QA');
  });
  it('digest subjects', () => {
    // 2026-10-18: no case ending on the group's name ("v Firma" was wrong in Slovak).
    expect(texts('en').digestSubject(1, 'Firma')).toBe('1 new message – Firma');
    expect(texts('en').digestSubject(3, 'Firma')).toBe('3 new messages – Firma');
    expect(texts('sk').digestSubject(1, 'Firma')).toBe('1 nová správa – Firma');
    expect(texts('sk').digestSubject(3, 'Firma')).toBe('3 nové správy – Firma');
    expect(texts('sk').digestSubject(5, 'Firma')).toBe('5 nových správ – Firma');
    expect(texts('en').digestUpdates(2, 'Ticket #12')).toBe('Ticket #12: 2 updates');
    expect(texts('sk').digestUpdates(2, 'Tiket #12')).toBe('Tiket #12: 2 zmeny');
    expect(texts('sk').digestUpdates(5, 'Tiket #12')).toBe('Tiket #12: 5 zmien');
    expect(texts('en').digestMany(4, ['Ticket #12', 'Firma'], 0)).toBe(
      '4 updates: Ticket #12, Firma',
    );
    expect(texts('en').digestMany(9, ['Ticket #12', 'Firma'], 3)).toBe(
      '9 updates: Ticket #12, Firma and 3 more',
    );
    expect(texts('sk').digestMany(9, ['Tiket #12', 'Firma'], 3)).toBe(
      '9 zmien: Tiket #12, Firma a ďalšie 3',
    );
    expect(texts('en').digestMore(2)).toBe('And 2 more in Help.');
    expect(texts('sk').digestButton('Firma')).toBe('Otvoriť Firma');
    expect(texts('en').digestButton('Firma')).toBe('Open Firma');
  });
  it('every language has the digest and the 2026-10-18 texts', () => {
    for (const lang of UserLanguages) {
      const t = texts(lang);
      expect(t.digestSubject(3, 'Firma')).toContain('Firma');
      expect(t.digestUpdates(3, 'Firma')).toContain('Firma');
      expect(t.digestMany(7, ['A1', 'B2'], 2)).toMatch(/7.*A1.*B2.*2/);
      expect(t.digestMore(2)).toContain('2');
      expect(t.dueChanged('31 Oct 2026')).toContain('31 Oct 2026');
      expect(t.dueRemoved).not.toBe('');
      expect(t.overdue('31 Oct 2026')).toContain('31 Oct 2026');
      expect(t.ticketResolved(12)).toContain('#12');
    }
  });
});

describe('buildPushPayload tickets (Phase 21.6)', () => {
  const ticket = { ticketId: 'k1', number: 123, subject: 'Login fails', groupId: 'g1' };
  const t = (kind: string, payload: Record<string, unknown>, lang: 'sk' | 'en') =>
    buildPushPayload({
      ...base,
      kind: kind as Parameters<typeof buildPushPayload>[0]['kind'],
      payload: { ...ticket, ...payload },
      lang,
    });

  it.each([
    ['ticket.created', {}, 'en', 'New ticket #123 · Firma', 'Login fails'],
    ['ticket.created', {}, 'sk', 'Nový tiket #123 · Firma', 'Login fails'],
    ['ticket.unassigned', { groupId: null }, 'en', 'New ticket #123 without client', 'Login fails'],
    ['ticket.unassigned', { groupId: null }, 'sk', 'Nový tiket #123 bez klienta', 'Login fails'],
    [
      'ticket.message',
      { authorName: 'Jana', excerpt: 'text' },
      'en',
      '#123 Login fails',
      'Jana: text',
    ],
    [
      'ticket.message',
      { authorName: 'Jana', excerpt: 'text' },
      'sk',
      '#123 Login fails',
      'Jana: text',
    ],
    [
      'ticket.status',
      { status: 'in_progress' },
      'en',
      'Ticket #123: status “In progress”',
      'Login fails',
    ],
    [
      'ticket.status',
      { status: 'in_progress' },
      'sk',
      'Tiket #123: stav „V riešení“',
      'Login fails',
    ],
    ['ticket.status', { status: 'resolved' }, 'sk', 'Tiket #123: stav „Vyriešený“', 'Login fails'],
    ['ticket.updated', {}, 'en', 'Ticket #123: details updated', 'Login fails'],
    ['ticket.updated', {}, 'sk', 'Tiket #123: upravené údaje', 'Login fails'],
    ['ticket.tasks', { count: 2 }, 'en', 'Ticket #123: 2 tasks created', 'Login fails'],
    ['ticket.tasks', { count: 1 }, 'en', 'Ticket #123: 1 task created', 'Login fails'],
    ['ticket.tasks', { count: 2 }, 'sk', 'Tiket #123: vytvorené 2 úlohy', 'Login fails'],
    ['ticket.tasks', { count: 5 }, 'sk', 'Tiket #123: vytvorených 5 úloh', 'Login fails'],
    [
      'chat.mention',
      { authorName: 'Jana', excerpt: 'pozri' },
      'sk',
      '#123 Login fails',
      'Jana: pozri',
    ],
  ] as const)('%s %j (%s): "%s" / "%s"', (kind, payload, lang, title, body) => {
    expect(t(kind, payload, lang)).toMatchObject({
      title,
      body,
      url: '/tickets/k1',
      tag: 'ticket:k1',
    });
  });

  it('a ticket without a subject is named by its number only', () => {
    expect(
      t('ticket.message', { subject: null, authorName: 'Jana', excerpt: 'x' }, 'en').title,
    ).toBe('#123');
    expect(t('ticket.updated', { subject: null }, 'en').body).toBe('');
  });
});

describe('buildPushPayload meetings (2026-10-17)', () => {
  const meeting = {
    itemId: 'k1',
    groupId: 'g1',
    title: 'Kickoff',
    startsAt: '2026-10-22T08:00:00Z', // 10:00 in Bratislava
  };
  const m = (kind: NotificationKind, lang: 'en' | 'sk' = 'en') =>
    buildPushPayload({ ...base, kind, payload: meeting, lang });

  it('every meeting push is "<title> · <group>", opens the item, tag knowledge:<id>', () => {
    const kinds: NotificationKind[] = [
      'meeting.scheduled',
      'meeting.rescheduled',
      'meeting.summary_ready',
      'meeting.summary_failed',
    ];
    for (const kind of kinds) {
      expect(m(kind)).toMatchObject({
        title: 'Kickoff · Firma',
        url: '/groups/g1/knowledge?k=k1',
        tag: 'knowledge:k1',
      });
    }
  });

  it('the bodies, with the Bratislava time', () => {
    expect(m('meeting.scheduled').body).toBe('New meeting: Thu 22 Oct, 10:00');
    expect(m('meeting.rescheduled').body).toBe('Meeting moved to Thu 22 Oct, 10:00');
    expect(m('meeting.summary_ready').body).toBe('The summary from AI is ready');
    expect(m('meeting.summary_failed').body).toBe('AI processing failed');
    expect(m('meeting.scheduled', 'sk').body).toMatch(/^Nové stretnutie: .*10:00/);
  });

  it('a meeting reminder still opens the item (the knowledge reminder push)', () => {
    const payload = {
      subjectKind: 'knowledge',
      subjectId: 'k1',
      groupId: 'g1',
      title: 'Kickoff',
      at: '2026-10-22T07:45:00Z',
      meeting: true,
    };
    expect(buildPushPayload({ ...base, kind: 'reminder.due', payload, lang: 'en' })).toMatchObject({
      url: '/groups/g1/knowledge?k=k1',
      tag: 'knowledge:k1',
    });
  });

  it('every language has the meeting texts', () => {
    for (const lang of UserLanguages) {
      const t = texts(lang);
      expect(t.meetingScheduled('X')).toContain('X');
      expect(t.meetingRescheduled('X')).toContain('X');
      expect(t.meetingSummaryReady).not.toBe('');
      expect(t.meetingSummaryFailed).not.toBe('');
      expect(t.openMeeting).not.toBe('');
    }
  });
});

describe('buildPushPayload time requests (Phase 32)', () => {
  it('a task time request: "<title> · <client>", "Record your time", the task with the dialog', () => {
    const push = buildPushPayload({
      ...base,
      kind: 'task.time_missing',
      payload: task,
      lang: 'en',
    });
    expect(push).toMatchObject({
      title: 'Report · Firma',
      body: 'Record your time',
      url: '/groups/g1/tasks/t1?time=1',
      tag: 'task:t1',
    });
  });
  it('a ticket time request opens the ticket with the dialog', () => {
    const push = buildPushPayload({
      ...base,
      kind: 'ticket.time_missing',
      payload: { ticketId: 'k1', groupId: 'g1', number: 12, title: 'Login fails', actorName: 'J' },
      lang: 'en',
    });
    expect(push).toMatchObject({
      title: '#12 Login fails · Firma',
      body: 'Record your time',
      url: '/tickets/k1?time=1',
      tag: 'ticket:k1',
    });
  });
  it('every language has the texts', () => {
    for (const lang of UserLanguages) {
      expect(texts(lang).timeMissing).not.toBe('');
      expect(texts(lang).timeMissingLine('X')).toContain('X');
      expect(texts(lang).openTask).not.toBe('');
    }
  });
});

describe('2026-10-18 task signals', () => {
  const t = { ...base, taskTitle: 'Report', lang: 'en' } as const;
  it('due date changed: "Due date changed to <day>", or removed', () => {
    const push = buildPushPayload({
      ...t,
      kind: 'task.due_changed',
      payload: { ...task, dueDate: '2026-10-31', previousDueDate: '2026-10-20' },
    });
    expect(push).toMatchObject({
      title: 'Report · Firma',
      body: 'Due date changed to 31 Oct 2026',
      url: '/groups/g1/tasks/t1',
      tag: 'task:t1',
    });
    expect(
      buildPushPayload({
        ...t,
        kind: 'task.due_changed',
        payload: { ...task, dueDate: null, previousDueDate: '2026-10-20' },
      }).body,
    ).toBe('Due date removed');
    expect(
      buildPushPayload({
        ...t,
        lang: 'sk',
        kind: 'task.due_changed',
        payload: { ...task, dueDate: '2026-10-31' },
      }).body,
    ).toMatch(/^Termín zmenený na 31\./);
  });
  it('overdue: "Overdue, was due <day>"', () => {
    const push = buildPushPayload({
      ...t,
      kind: 'task.overdue',
      payload: { ...task, dueDate: '2026-10-17' },
    });
    expect(push).toMatchObject({
      title: 'Report · Firma',
      body: 'Overdue, was due 17 Oct 2026',
      url: '/groups/g1/tasks/t1',
      tag: 'task:t1',
    });
  });
});

describe('ticket resolved (2026-10-18)', () => {
  it('"Ticket #123 resolved" with the subject, opening the ticket', () => {
    const payload = { ticketId: 'k1', number: 123, subject: 'Login fails', groupId: 'g1' };
    expect(buildPushPayload({ ...base, kind: 'ticket.resolved', payload, lang: 'en' })).toEqual({
      title: 'Ticket #123 resolved',
      body: 'Login fails',
      // 2026-10-19: it opens the rating card (the page decides whether the viewer rates).
      url: '/tickets/k1?rate=1',
      tag: 'ticket:k1',
      renotify: true,
    });
    expect(buildPushPayload({ ...base, kind: 'ticket.resolved', payload }).title).toBe(
      'Tiket #123 je vyriešený',
    );
  });
});

describe('ticket rated (2026-10-19)', () => {
  it('"Tiket #123: negatívne hodnotenie" with the subject, opening the ticket', () => {
    const payload = {
      ticketId: 'k1',
      number: 123,
      subject: 'Login fails',
      groupId: 'g1',
      value: 'down',
    };
    expect(buildPushPayload({ ...base, kind: 'ticket.rated', payload })).toEqual({
      title: 'Tiket #123: negatívne hodnotenie',
      body: 'Login fails',
      url: '/tickets/k1',
      tag: 'ticket:k1',
      renotify: true,
    });
    expect(buildPushPayload({ ...base, kind: 'ticket.rated', payload, lang: 'en' }).title).toBe(
      'Ticket #123: negative rating',
    );
  });
});

describe('renotify (2026-10-18)', () => {
  const ticket = { ticketId: 'k1', number: 1, subject: 'S', groupId: 'g1' };
  const push = (kind: NotificationKind, payload: Record<string, unknown> = task) =>
    buildPushPayload({ ...base, kind, payload, taskTitle: 'Report' });

  it('a stream of messages and updates replaces its card silently', () => {
    expect(push('chat.message', chat).renotify).toBeUndefined();
    expect(push('chat.thread_reply', chat).renotify).toBeUndefined();
    expect(push('chat.message', { ...chat, taskId: 't1' }).renotify).toBeUndefined();
    expect(
      push('ticket.message', { ...ticket, authorName: 'J', excerpt: 'x' }).renotify,
    ).toBeUndefined();
    for (const kind of ['task.moved', 'task.due_changed'] as const) {
      expect(push(kind).renotify).toBeUndefined();
    }
    for (const kind of ['ticket.status', 'ticket.updated', 'ticket.tasks'] as const) {
      expect(push(kind, { ...ticket, status: 'in_progress', count: 1 }).renotify).toBeUndefined();
    }
  });

  it('what is addressed to the person or due now alerts again', () => {
    expect(push('chat.mention', chat).renotify).toBe(true);
    for (const kind of [
      'task.assigned',
      'task.deadline',
      'task.urgent',
      'task.overdue',
      'task.time_missing',
    ] as const) {
      expect(push(kind, { ...task, daysLeft: 1, dueDate: '2026-10-17' }).renotify).toBe(true);
    }
    for (const kind of [
      'ticket.assigned',
      'ticket.created',
      'ticket.unassigned',
      'ticket.resolved',
      'ticket.rated',
      'ticket.time_missing',
    ] as const) {
      expect(push(kind, ticket).renotify).toBe(true);
    }
    expect(
      push('reminder.due', { subjectKind: 'task', taskId: 't1', groupId: 'g1', at: '' }).renotify,
    ).toBe(true);
  });
});

describe('buildPushPayload description.mention (F16)', () => {
  const mention = (payload: Record<string, unknown>, taskTitle: string | null = null) =>
    buildPushPayload({ ...base, kind: 'description.mention', payload, taskTitle, lang: 'en' });
  const common = { groupId: 'g1', actorName: 'Jana' };
  it('a task opens the task panel under its current title, and alerts again', () => {
    expect(
      mention(
        { ...common, subjectKind: 'task', subjectId: 't1', taskId: 't1', title: 'Old' },
        'Report',
      ),
    ).toEqual({
      title: 'Report · Firma',
      body: 'Jana mentioned you in the description',
      url: '/groups/g1/tasks/t1',
      tag: 'task:t1',
      renotify: true,
    });
  });
  it('a ticket opens the ticket', () => {
    const payload = { ...common, subjectKind: 'ticket', subjectId: 'k1', ticketId: 'k1' };
    expect(mention({ ...payload, number: 7, subject: 'Login' })).toMatchObject({
      title: '#7 Login',
      url: '/tickets/k1',
      tag: 'ticket:k1',
    });
  });
  it('a knowledge item and a project open on their tabs', () => {
    expect(
      mention({ ...common, subjectKind: 'knowledge', subjectId: 'i1', title: 'Notes' }),
    ).toMatchObject({ title: 'Notes · Firma', url: '/groups/g1/knowledge?k=i1' });
    expect(
      mention({ ...common, subjectKind: 'project', subjectId: 'p1', title: 'Grant' }),
    ).toMatchObject({ title: 'Grant · Firma', url: '/groups/g1/overview?project=p1' });
  });
  it('every language has the texts', () => {
    for (const lang of UserLanguages) {
      expect(texts(lang).mentionedInDescription('Jana')).toContain('Jana');
      expect(texts(lang).openKnowledge).not.toBe('');
      expect(texts(lang).openProject).not.toBe('');
    }
  });
});

describe('push actions (N6a, ADR 0047)', () => {
  const ticket = { ticketId: 'k1', number: 7, subject: 'Login fails', groupId: 'g1' };
  const push = (
    kind: NotificationKind,
    payload: Record<string, unknown> = task,
    extra: Partial<Parameters<typeof buildPushPayload>[0]> = {},
  ) => buildPushPayload({ ...base, kind, payload, taskTitle: 'Report', lang: 'en', ...extra });
  const done = { action: 'done', title: 'Done', taskId: 't1' };

  it('"Done" on the pushes about an open task addressed to the person', () => {
    for (const kind of [
      'task.assigned',
      'task.deadline',
      'task.urgent',
      'task.overdue',
      'task.due_changed',
    ] as const) {
      expect(push(kind, { ...task, daysLeft: 1, dueDate: '2026-10-17' }).actions).toEqual([done]);
    }
    const reminder = { subjectKind: 'task', subjectId: 't1', taskId: 't1', groupId: 'g1', at: '' };
    expect(push('reminder.due', reminder).actions).toEqual([done]);
    expect(push('task.urgent', task, { lang: 'sk' }).actions).toEqual([
      { ...done, title: 'Hotovo' },
    ]);
  });

  it('"Log time" on the time requests: it opens the time dialog', () => {
    expect(push('task.time_missing').actions).toEqual([
      { action: 'time', title: 'Log time', url: '/groups/g1/tasks/t1?time=1' },
    ]);
    const request = { ticketId: 'k1', groupId: 'g1', number: 7, title: 'Login fails' };
    expect(push('ticket.time_missing', request, { lang: 'sk' }).actions).toEqual([
      { action: 'time', title: 'Zapísať čas', url: '/tickets/k1?time=1' },
    ]);
  });

  it('"Reply" on group chat messages and mentions: the channel, top level, and the composer', () => {
    const reply = {
      action: 'reply',
      title: 'Reply',
      placeholder: 'Write a reply…',
      channelId: 'c1',
      parentId: null,
      url: '/groups/g1/chat?message=m1&c=c1&reply=1',
    };
    expect(push('chat.message', chat).actions).toEqual([reply]);
    expect(push('chat.mention', chat).actions).toEqual([reply]);
  });

  it('"Reply" in a thread answers in the thread; in a task chat it opens the task chat', () => {
    expect(push('chat.thread_reply', chat, { parentId: 'r1' }).actions).toMatchObject([
      {
        action: 'reply',
        channelId: 'c1',
        parentId: 'r1',
        url: '/groups/g1/chat?thread=r1&message=m1&c=c1&reply=1',
      },
    ]);
    expect(push('chat.message', { ...chat, taskId: 't1' }).actions).toMatchObject([
      {
        action: 'reply',
        channelId: 'c1',
        parentId: null,
        url: '/groups/g1/tasks/t1?tab=chat&message=m1&c=c1&reply=1',
      },
    ]);
  });

  it('"Reply" on a ticket chat message or mention opens the ticket chat', () => {
    const message = { ...ticket, channelId: 'c9', messageId: 'm9', authorName: 'J', excerpt: 'x' };
    for (const kind of ['ticket.message', 'chat.mention'] as const) {
      expect(push(kind, message, { lang: 'sk' }).actions).toEqual([
        {
          action: 'reply',
          title: 'Odpovedať',
          placeholder: 'Napíšte odpoveď…',
          channelId: 'c9',
          parentId: null,
          url: '/tickets/k1?message=m9&c=c9&reply=1',
        },
      ]);
    }
  });

  it('no action where none fits, and never on finance or meeting pushes', () => {
    expect(
      push('task.moved', { ...task, toBucket: { kind: 'done', name: null } }).actions,
    ).toBeUndefined();
    for (const kind of [
      'ticket.created',
      'ticket.status',
      'ticket.resolved',
      'ticket.assigned',
    ] as const) {
      expect(push(kind, { ...ticket, status: 'in_progress' }).actions).toBeUndefined();
    }
    const finance = { subjectKind: 'finance', subjectId: 'f1', groupId: 'g1', title: 'C', at: '' };
    expect(push('reminder.due', finance).actions).toBeUndefined();
    const knowledge = { subjectKind: 'knowledge', subjectId: 'k1', groupId: 'g1', at: '' };
    expect(push('reminder.due', knowledge).actions).toBeUndefined();
    expect(
      push('meeting.scheduled', { itemId: 'i1', groupId: 'g1', title: 'M' }).actions,
    ).toBeUndefined();
    // A chat event without its channel (an old event) gets no reply.
    expect(push('chat.message', { ...chat, channelId: undefined }).actions).toBeUndefined();
  });

  it('every language names the actions', () => {
    for (const lang of UserLanguages) {
      const t = texts(lang);
      for (const text of [t.actionDone, t.actionLogTime, t.actionReply, t.replyPlaceholder]) {
        expect(text.trim()).not.toBe('');
        expect(text.length).toBeLessThanOrEqual(24);
      }
    }
  });
});
