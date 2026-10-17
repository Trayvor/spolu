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
    ).toEqual({ title: 'Report · Firma', body: 'Moved to eGrant review', url, tag: 'task:t1' });
    expect(
      buildPushPayload({
        ...en,
        payload: { ...task, toBucket: { kind: 'client_review', name: 'Firma' } },
      }).body,
    ).toBe('Moved to Firma review');
    expect(
      buildPushPayload({
        ...t,
        kind: 'task.moved',
        payload: { ...task, toBucket: { kind: 'egrant_review', name: null } },
      }).body,
    ).toBe('Presunuté do Kontrola eGrant');
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
    expect(texts('en').bucket({ kind: 'done', name: null })).toBe('Completed');
    expect(texts('sk').bucket({ kind: 'client_review', name: 'Firma' })).toBe('Kontrola Firma');
    expect(texts('sk').bucket({ kind: 'done', name: null })).toBe('Hotové');
    expect(texts('en').bucket({ kind: 'custom', name: 'QA' })).toBe('QA');
  });
  it('digest subjects', () => {
    expect(texts('en').digestSubject(1, 'Firma')).toBe('1 new message in Firma');
    expect(texts('en').digestSubject(3, 'Firma')).toBe('3 new messages in Firma');
    expect(texts('sk').digestSubject(1, 'Firma')).toBe('1 nová správa v Firma');
    expect(texts('sk').digestSubject(3, 'Firma')).toBe('3 nové správy v Firma');
    expect(texts('sk').digestSubject(5, 'Firma')).toBe('5 nových správ v Firma');
    expect(texts('sk').digestButton('Firma')).toBe('Otvoriť Firma');
    expect(texts('en').digestButton('Firma')).toBe('Open Firma');
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
    ['ticket.status', { status: 'in_progress' }, 'en', '#123 is now In progress', 'Login fails'],
    ['ticket.status', { status: 'in_progress' }, 'sk', '#123 je teraz V riešení', 'Login fails'],
    ['ticket.status', { status: 'resolved' }, 'sk', '#123 je teraz Vyriešený', 'Login fails'],
    ['ticket.updated', {}, 'en', '#123 was changed', 'Login fails'],
    ['ticket.updated', {}, 'sk', '#123 bol zmenený', 'Login fails'],
    ['ticket.tasks', { count: 2 }, 'en', '#123 turned into 2 tasks', 'Login fails'],
    ['ticket.tasks', { count: 1 }, 'en', '#123 turned into 1 task', 'Login fails'],
    ['ticket.tasks', { count: 2 }, 'sk', '#123 rozdelený na 2 úlohy', 'Login fails'],
    ['ticket.tasks', { count: 5 }, 'sk', '#123 rozdelený na 5 úloh', 'Login fails'],
    [
      'chat.mention',
      { authorName: 'Jana', excerpt: 'pozri' },
      'sk',
      '#123 Login fails',
      'Jana: pozri',
    ],
  ] as const)('%s %j (%s): "%s" / "%s"', (kind, payload, lang, title, body) => {
    expect(t(kind, payload, lang)).toEqual({ title, body, url: '/tickets/k1', tag: 'ticket:k1' });
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
    expect(m('meeting.summary_ready').body).toBe('AI summary is ready');
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
  it('a task time request: "<title> · <client>", "Fill in…", the task with the dialog', () => {
    const push = buildPushPayload({
      ...base,
      kind: 'task.time_missing',
      payload: task,
      lang: 'en',
    });
    expect(push).toEqual({
      title: 'Report · Firma',
      body: 'Fill in how much time you spent',
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
    expect(push).toEqual({
      title: '#12 Login fails · Firma',
      body: 'Fill in how much time you spent',
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
