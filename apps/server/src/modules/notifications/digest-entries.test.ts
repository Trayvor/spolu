import { describe, expect, it } from 'vitest';
import { digestEntry, type DigestContext } from './digest-entries.js';

const ctx: DigestContext = {
  groupName: 'Firma',
  groupId: 'g1',
  publicUrl: 'https://spolu.test',
  lang: 'en',
  taskTitles: new Map([['t1', 'Current title']]),
};
const chatUrl = 'https://spolu.test/groups/g1/chat';

describe('digestEntry', () => {
  it('a chat message: "Jana: text", the group chat and "Open <group>"', () => {
    expect(
      digestEntry({ kind: 'chat.message', payload: { authorName: 'Jana', excerpt: 'hello' } }, ctx),
    ).toEqual({ line: 'Jana: hello', url: chatUrl, button: 'Open group', topic: 'Firma' });
  });

  it('a task event: "<body>: <current task title>"', () => {
    expect(
      digestEntry(
        { kind: 'task.assigned', payload: { taskId: 't1', actorName: 'Jana', title: 'Old' } },
        ctx,
      ),
    ).toEqual({
      line: 'Jana assigned you to this task: Current title',
      url: chatUrl,
      button: 'Open group',
      topic: 'Firma',
    });
  });

  it('a task reminder shows the current task title', () => {
    const entry = digestEntry(
      {
        kind: 'reminder.due',
        payload: { subjectKind: 'task', taskId: 't1', title: 'Old', at: '2026-10-25T09:00:00Z' },
      },
      ctx,
    );
    expect(entry?.line).toBe('Reminder: Current title, Sun 25 Oct, 10:00');
  });

  it('a finance contract reminder: "Contract <title> · <client>: ends on …", opening the item', () => {
    const entry = digestEntry(
      {
        kind: 'reminder.due',
        payload: {
          subjectKind: 'finance',
          subjectId: 'f1',
          title: 'Zmluva 2026',
          at: '2026-12-01T08:00:00Z',
          endsOn: '2026-12-31',
        },
      },
      ctx,
    );
    expect(entry).toEqual({
      line: expect.stringMatching(/^Contract Zmluva 2026 · Firma: ends on .*2026$/),
      url: 'https://spolu.test/groups/g1/finance?item=f1',
      button: 'Open contract',
      topic: 'Firma',
    });
  });

  it("an expense's reminder (Phase 32 E): its own email opening /finance, no client", () => {
    const entry = digestEntry(
      {
        kind: 'reminder.due',
        payload: {
          subjectKind: 'finance',
          subjectId: 'e1',
          groupId: null,
          title: 'Eva Nováková',
          at: '2026-10-30T08:00:00Z',
          dueOn: '2026-10-31',
          salary: true,
        },
      },
      { ...ctx, groupId: null, groupName: null },
    );
    expect(entry).toEqual({
      line: expect.stringMatching(/^Expense Salary: Eva Nováková: due on .*2026$/),
      url: 'https://spolu.test/finance?item=e1',
      button: 'Open expense',
      topic: 'Finance',
    });
  });

  it('a reminder of a contract of several clients (Phase 32 E) opens /finance', () => {
    const entry = digestEntry(
      {
        kind: 'reminder.due',
        payload: {
          subjectKind: 'finance',
          subjectId: 'c1',
          groupId: null,
          title: 'Grant',
          at: '2026-12-01T08:00:00Z',
          endsOn: '2026-12-31',
        },
      },
      { ...ctx, groupId: null, groupName: null },
    );
    expect(entry).toMatchObject({
      line: expect.stringMatching(/^Contract Grant · Finance: ends on/),
      url: 'https://spolu.test/finance?item=c1',
      button: 'Open contract',
    });
  });

  it('an event of a non-ticket group without a client group gives null', () => {
    expect(
      digestEntry(
        { kind: 'chat.message', payload: { authorName: 'Jana', excerpt: 'x' } },
        { ...ctx, groupId: null, groupName: null },
      ),
    ).toBeNull();
  });

  it('an unknown kind gives null', () => {
    expect(digestEntry({ kind: 'ticket.bogus', payload: {} }, ctx)).toBeNull();
  });
});

describe('digestEntry tickets (Phase 21.6)', () => {
  const ticket = { ticketId: 'k1', number: 123, subject: 'Login fails' };
  const open = {
    url: 'https://spolu.test/tickets/k1',
    button: 'Open ticket',
    topic: 'Ticket #123',
  };

  it('a ticket message: "#123 Subject: Jana: text", the ticket page, "Open ticket"', () => {
    expect(
      digestEntry(
        { kind: 'ticket.message', payload: { ...ticket, authorName: 'Jana', excerpt: 'text' } },
        ctx,
      ),
    ).toEqual({ line: '#123 Login fails: Jana: text', ...open });
  });

  it('a mention in a ticket chat opens the ticket too', () => {
    expect(
      digestEntry(
        { kind: 'chat.mention', payload: { ...ticket, authorName: 'Jana', excerpt: 'text' } },
        ctx,
      ),
    ).toEqual({ line: '#123 Login fails: Jana: text', ...open });
  });

  it('a status change: "<title>: <subject>"', () => {
    expect(
      digestEntry({ kind: 'ticket.status', payload: { ...ticket, status: 'resolved' } }, ctx)?.line,
    ).toBe('Ticket #123: status “Resolved”: Login fails');
  });

  it('a ticket without a client group still gets its entry, in Slovak too', () => {
    expect(
      digestEntry(
        { kind: 'ticket.unassigned', payload: ticket },
        { ...ctx, groupId: null, groupName: null, lang: 'sk' },
      ),
    ).toEqual({
      line: 'Nový tiket #123 bez klienta: Login fails',
      url: 'https://spolu.test/tickets/k1',
      button: 'Otvoriť tiket',
      topic: 'Tiket #123',
    });
  });
});

describe('digestEntry meetings (2026-10-17)', () => {
  const meeting = {
    itemId: 'k1',
    groupId: 'g1',
    title: 'Kickoff',
    startsAt: '2026-10-22T08:00:00Z',
  };

  it('"<title>: <what happened>", the item, "Open meeting", the group as topic', () => {
    expect(digestEntry({ kind: 'meeting.scheduled', payload: meeting }, ctx)).toEqual({
      line: 'Kickoff: New meeting: Thu 22 Oct, 10:00',
      url: 'https://spolu.test/groups/g1/knowledge?k=k1',
      button: 'Open meeting',
      topic: 'Firma',
    });
    expect(digestEntry({ kind: 'meeting.summary_ready', payload: meeting }, ctx)?.line).toBe(
      'Kickoff: The summary from AI is ready',
    );
  });

  it('a meeting reminder is a reminder line', () => {
    const entry = digestEntry(
      {
        kind: 'reminder.due',
        payload: {
          subjectKind: 'knowledge',
          subjectId: 'k1',
          title: 'Kickoff',
          at: '2026-10-22T07:45:00Z',
          meeting: true,
        },
      },
      ctx,
    );
    expect(entry?.line).toBe('Reminder: Kickoff, Thu 22 Oct, 09:45');
  });
});

describe('digestEntry time requests (Phase 32)', () => {
  it('a task time request: "<title>: record your time", opening the task', () => {
    expect(
      digestEntry(
        { kind: 'task.time_missing', payload: { taskId: 't1', groupId: 'g1', title: 'Old' } },
        ctx,
      ),
    ).toEqual({
      line: 'Current title: record your time',
      url: 'https://spolu.test/groups/g1/tasks/t1?time=1',
      button: 'Open task',
      topic: 'Firma',
    });
  });
  it('a ticket time request opens the ticket', () => {
    expect(
      digestEntry(
        {
          kind: 'ticket.time_missing',
          payload: { ticketId: 'k1', groupId: 'g1', number: 12, title: 'Login fails' },
        },
        ctx,
      ),
    ).toMatchObject({
      line: '#12 Login fails: record your time',
      url: 'https://spolu.test/tickets/k1?time=1',
      button: 'Open ticket',
    });
  });
});
