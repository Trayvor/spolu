import { describe, expect, it } from 'vitest';
import { NotificationKinds, type GroupMode, type NotificationKind } from '@spolu/shared';
import { NOTIFICATION_GROUP_OF } from './categories.js';
import { decideEvent, isOutranked, KIND_RANK, passesMode } from './decide.js';

const table: [NotificationKind, Record<GroupMode, boolean>][] = [
  ['chat.message', { all: true, mentions: false, off: false }],
  ['chat.mention', { all: true, mentions: true, off: false }],
  ['chat.thread_reply', { all: true, mentions: true, off: false }],
  ['task.moved', { all: true, mentions: true, off: false }],
  ['task.assigned', { all: true, mentions: true, off: false }],
  ['task.deadline', { all: true, mentions: true, off: false }],
  ['task.urgent', { all: true, mentions: true, off: false }],
  ['reminder.due', { all: true, mentions: true, off: true }],
  ['ticket.created', { all: true, mentions: true, off: true }],
  ['ticket.unassigned', { all: true, mentions: true, off: true }],
  ['ticket.message', { all: true, mentions: true, off: true }],
  ['ticket.status', { all: true, mentions: true, off: true }],
  ['ticket.updated', { all: true, mentions: true, off: true }],
  ['ticket.tasks', { all: true, mentions: true, off: true }],
  ['ticket.assigned', { all: true, mentions: true, off: true }],
  // Scheduling reads like a plain message; an AI result was asked for by its one recipient.
  ['meeting.scheduled', { all: true, mentions: false, off: false }],
  ['meeting.rescheduled', { all: true, mentions: false, off: false }],
  ['meeting.summary_ready', { all: true, mentions: true, off: true }],
  ['meeting.summary_failed', { all: true, mentions: true, off: true }],
];
const cases = table.flatMap(([kind, modes]) =>
  (['all', 'mentions', 'off'] as const).map((mode) => [kind, mode, modes[mode]] as const),
);

describe('passesMode', () => {
  it('covers every kind', () => {
    expect(table.map(([k]) => k).sort()).toEqual([...NotificationKinds].sort());
  });
  it.each(cases)('%s in %s mode -> %s', (kind, mode, expected) => {
    expect(passesMode(kind, NOTIFICATION_GROUP_OF[kind], mode)).toBe(expected);
  });
  it('a ticket board event passes every mode, Off included', () => {
    for (const mode of ['all', 'mentions', 'off'] as const) {
      expect(passesMode('chat.message', 'tickets', mode)).toBe(true);
    }
  });
});

const open = {
  kind: 'chat.message',
  mode: 'all',
  isGroupPerson: true,
  unread: true,
  outranked: false,
  group: 'chat',
  channel: 'both',
  pushAvailable: true,
  hasSubscriptions: true,
} as const;

describe('decideEvent', () => {
  it('sends push and email when everything allows', () => {
    expect(decideEvent(open)).toEqual({ push: true, email: true });
  });
  it('outranked event sends nothing', () => {
    expect(decideEvent({ ...open, outranked: true })).toEqual({ push: false, email: false });
  });
  it('read event sends nothing', () => {
    expect(decideEvent({ ...open, unread: false })).toEqual({ push: false, email: false });
  });
  it('not a group person sends nothing', () => {
    expect(decideEvent({ ...open, isGroupPerson: false })).toEqual({ push: false, email: false });
  });
  it('mode filter applies', () => {
    expect(decideEvent({ ...open, mode: 'mentions' })).toEqual({ push: false, email: false });
    expect(decideEvent({ ...open, mode: 'off', kind: 'task.urgent' })).toEqual({
      push: false,
      email: false,
    });
  });
  it.each([
    ['email', { push: false, email: true }],
    ['push', { push: true, email: false }],
    ['both', { push: true, email: true }],
    ['none', { push: false, email: false }],
  ] as const)('channel %s -> %j', (channel, expected) => {
    expect(decideEvent({ ...open, channel })).toEqual(expected);
  });
  it('push unavailable on the server still allows email', () => {
    expect(decideEvent({ ...open, pushAvailable: false })).toEqual({ push: false, email: true });
  });
  it('a ticket board event passes Off', () => {
    expect(decideEvent({ ...open, group: 'tickets', mode: 'off' })).toEqual({
      push: true,
      email: true,
    });
  });
  it('no subscriptions means no push', () => {
    expect(decideEvent({ ...open, hasSubscriptions: false })).toEqual({ push: false, email: true });
  });
});

describe('reminder.due', () => {
  it('reminder.due passes All, Mentions and Off', () => {
    for (const mode of ['all', 'mentions', 'off'] as const) {
      expect(decideEvent({ ...open, kind: 'reminder.due', mode })).toEqual({
        push: true,
        email: true,
      });
    }
  });
  it('reminder.due is still dropped for someone no longer in the group', () => {
    expect(
      decideEvent({ ...open, kind: 'reminder.due', mode: 'off', isGroupPerson: false }),
    ).toEqual({ push: false, email: false });
  });
});

describe('reminder.due ranking', () => {
  it('has the rank of a mention and is never outranked without siblings', () => {
    expect(KIND_RANK['reminder.due']).toBe(KIND_RANK['chat.mention']);
    expect(isOutranked({ id: 'a', kind: 'reminder.due' }, [])).toBe(false);
    expect(
      isOutranked({ id: 'a', kind: 'reminder.due' }, [{ id: 'a', kind: 'reminder.due' }]),
    ).toBe(false);
  });
  it('a lower-ranked message sibling does not outrank it', () => {
    expect(
      isOutranked({ id: 'z', kind: 'reminder.due' }, [{ id: 'a', kind: 'chat.message' }]),
    ).toBe(false);
  });
});

describe('isOutranked', () => {
  it('ranks chat.message below the rest', () => {
    expect(KIND_RANK['chat.message']).toBe(1);
    expect(KIND_RANK['chat.mention']).toBe(2);
  });
  it('a ticket message ranks like a chat message, so a mention of it wins', () => {
    expect(KIND_RANK['ticket.message']).toBe(1);
    expect(
      isOutranked({ id: 'a', kind: 'ticket.message' }, [{ id: 'b', kind: 'chat.mention' }]),
    ).toBe(true);
    for (const kind of ['ticket.created', 'ticket.unassigned', 'ticket.status'] as const) {
      expect(KIND_RANK[kind]).toBe(2);
    }
  });
  it('mention beats message, equal rank keeps the smaller id', () => {
    const msg = { id: 'b', kind: 'chat.message' } as const;
    const mention = { id: 'z', kind: 'chat.mention' } as const;
    expect(isOutranked(msg, [mention])).toBe(true);
    expect(isOutranked(mention, [msg])).toBe(false);
    const reply = { id: 'a', kind: 'chat.thread_reply' } as const;
    expect(isOutranked(mention, [reply])).toBe(true);
    expect(isOutranked(reply, [mention])).toBe(false);
    expect(isOutranked(reply, [reply])).toBe(false);
    expect(isOutranked(msg, [])).toBe(false);
  });
});
