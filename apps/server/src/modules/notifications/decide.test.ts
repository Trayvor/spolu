import { describe, expect, it } from 'vitest';
import { NotificationKinds, type GroupMode, type NotificationKind } from '@spolu/shared';
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
];
const cases = table.flatMap(([kind, modes]) =>
  (['all', 'mentions', 'off'] as const).map((mode) => [kind, mode, modes[mode]] as const),
);

describe('passesMode', () => {
  it('covers every kind', () => {
    expect(table.map(([k]) => k).sort()).toEqual([...NotificationKinds].sort());
  });
  it.each(cases)('%s in %s mode -> %s', (kind, mode, expected) => {
    expect(passesMode(kind, mode)).toBe(expected);
  });
});

const open = {
  kind: 'chat.message',
  mode: 'all',
  isGroupPerson: true,
  unread: true,
  outranked: false,
  pushEnabled: true,
  emailEnabled: true,
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
  it('push off still allows email', () => {
    expect(decideEvent({ ...open, pushEnabled: false })).toEqual({ push: false, email: true });
  });
  it('email off still allows push', () => {
    expect(decideEvent({ ...open, emailEnabled: false })).toEqual({ push: true, email: false });
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

describe('isOutranked', () => {
  it('ranks chat.message below the rest', () => {
    expect(KIND_RANK['chat.message']).toBe(1);
    expect(KIND_RANK['chat.mention']).toBe(2);
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
