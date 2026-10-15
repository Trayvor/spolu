import { describe, expect, it } from 'vitest';
import type { MessageDto, MessagePage, SendMessageInput, Thread } from '@spolu/shared';
import {
  MAX_IN_MEMORY,
  initialWindow,
  upsertIntoThread,
  windowReducer,
  type ChannelWindow,
} from './channel-window';

/** Message n is created n seconds after 10:00 (n < 3600), so ids and times sort together. */
function msg(n: number, over: Partial<MessageDto> = {}): MessageDto {
  const at = new Date(Date.UTC(2026, 9, 15, 10, 0, n)).toISOString();
  return {
    id: `m${String(n).padStart(4, '0')}`,
    channelId: 'c1',
    parentId: null,
    replyToId: null,
    author: { id: 'u1', name: 'Jana', isAdmin: false },
    body: `message ${n}`,
    mentions: [],
    mentionsAll: false,
    attachments: [],
    clientId: null,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: at,
    changeSeq: n,
    ...over,
  };
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));

/** A newest-first page, as the server answers `before` and latest requests. */
const latestPage = (messages: MessageDto[], over: Partial<MessagePage> = {}): MessagePage => ({
  messages: [...messages].reverse(),
  hasMore: false,
  lastSeq: Math.max(0, ...messages.map((m) => m.changeSeq)),
  lastReadAt: null,
  ...over,
});

const loaded = (messages: MessageDto[], over: Partial<MessagePage> = {}): ChannelWindow =>
  windowReducer(initialWindow, { type: 'loadedLatest', page: latestPage(messages, over) });

const ids = (w: ChannelWindow) => w.messages.map((m) => m.id);
const input = (clientId: string, over: Partial<SendMessageInput> = {}): SendMessageInput => ({
  body: 'hi',
  clientId,
  ...over,
});

describe('windowReducer', () => {
  it('loadedLatest keeps the messages oldest first and records the page state', () => {
    const w = loaded(range(1, 3), {
      hasMore: true,
      lastSeq: 9,
      lastReadAt: '2026-10-15T09:00:00.000Z',
    });
    expect(ids(w)).toEqual(['m0001', 'm0002', 'm0003']);
    expect(w).toMatchObject({ hasOlder: true, hasNewer: false, lastSeq: 9, loaded: true });
    expect(w.lastReadAt).toBe('2026-10-15T09:00:00.000Z');
    expect(w.unreadAnchor).toBe('2026-10-15T09:00:00.000Z');
  });

  it('upsert appends a new message at the bottom', () => {
    const w = windowReducer(loaded(range(1, 3)), { type: 'upsert', messages: [msg(4)] });
    expect(ids(w)).toEqual(['m0001', 'm0002', 'm0003', 'm0004']);
    expect(w.lastSeq).toBe(4);
  });

  it('upsert replaces a row with a newer changeSeq in place', () => {
    const edited = msg(2, { body: 'edited', changeSeq: 10 });
    const w = windowReducer(loaded(range(1, 3)), { type: 'upsert', messages: [edited] });
    expect(ids(w)).toEqual(['m0001', 'm0002', 'm0003']);
    expect(w.messages[1]!.body).toBe('edited');
    expect(w.lastSeq).toBe(10);
  });

  it('upsert with an older changeSeq never overwrites newer', () => {
    const start = windowReducer(loaded(range(1, 3)), {
      type: 'upsert',
      messages: [msg(2, { body: 'new', changeSeq: 10 })],
    });
    const w = windowReducer(start, {
      type: 'upsert',
      messages: [msg(2, { body: 'old', changeSeq: 7 })],
    });
    expect(w.messages[1]!.body).toBe('new');
    expect(w.lastSeq).toBe(10);
    expect(w).toBe(start);
  });

  it('upsert of the same message twice adds one row', () => {
    const once = windowReducer(loaded(range(1, 3)), { type: 'upsert', messages: [msg(4)] });
    const twice = windowReducer(once, { type: 'upsert', messages: [msg(4)] });
    expect(ids(twice)).toEqual(['m0001', 'm0002', 'm0003', 'm0004']);
    expect(twice).toBe(once);
  });

  it('event with my clientId replaces the pending row', () => {
    const sending = windowReducer(loaded(range(1, 2)), {
      type: 'pendingAdded',
      input: input('c-1'),
    });
    expect(sending.pending).toEqual([{ clientId: 'c-1', input: input('c-1'), status: 'sending' }]);
    const w = windowReducer(sending, { type: 'upsert', messages: [msg(3, { clientId: 'c-1' })] });
    expect(w.pending).toEqual([]);
    expect(ids(w)).toEqual(['m0001', 'm0002', 'm0003']);
  });

  it('a pending reply is removed when its reply arrives', () => {
    const sending = windowReducer(loaded(range(1, 2)), {
      type: 'pendingAdded',
      input: input('c-2', { parentId: 'm0001' }),
    });
    const reply = msg(3, { parentId: 'm0001', clientId: 'c-2' });
    const w = windowReducer(sending, { type: 'upsert', messages: [reply] });
    expect(w.pending).toEqual([]);
    expect(ids(w)).toEqual(['m0001', 'm0002']);
  });

  it('pendingFailed and pendingRetried switch the status of one row', () => {
    let w = windowReducer(loaded([]), { type: 'pendingAdded', input: input('a') });
    w = windowReducer(w, { type: 'pendingAdded', input: input('b') });
    w = windowReducer(w, { type: 'pendingFailed', clientId: 'a' });
    expect(w.pending.map((p) => p.status)).toEqual(['failed', 'sending']);
    w = windowReducer(w, { type: 'pendingRetried', clientId: 'a' });
    expect(w.pending.map((p) => p.status)).toEqual(['sending', 'sending']);
  });

  it('messages outside the window are ignored while hasOlder/hasNewer', () => {
    const around = windowReducer(initialWindow, {
      type: 'loadedAround',
      page: {
        messages: range(10, 12),
        hasOlder: true,
        hasNewer: true,
        targetId: 'm0011',
        lastSeq: 12,
        lastReadAt: null,
      },
    });
    const older = msg(5, { changeSeq: 20 });
    const newer = msg(15, { changeSeq: 21 });
    const w = windowReducer(around, { type: 'upsert', messages: [older, newer] });
    expect(ids(w)).toEqual(['m0010', 'm0011', 'm0012']);
    expect(w.lastSeq).toBe(21);
    // Without hasOlder/hasNewer they are taken, in order.
    const full = windowReducer(loaded(range(10, 12)), { type: 'upsert', messages: [older, newer] });
    expect(ids(full)).toEqual(['m0005', 'm0010', 'm0011', 'm0012', 'm0015']);
  });

  it('replies are ignored but lastSeq moves', () => {
    const reply = msg(30, { parentId: 'm0001' });
    const w = windowReducer(loaded(range(1, 2)), { type: 'upsert', messages: [reply] });
    expect(ids(w)).toEqual(['m0001', 'm0002']);
    expect(w.lastSeq).toBe(30);
  });

  it('loadedOlder prepends a page and drops duplicates', () => {
    const start = loaded(range(51, 100), { hasMore: true });
    const w = windowReducer(start, {
      type: 'loadedOlder',
      page: latestPage(range(1, 51), { hasMore: false, lastSeq: 999 }),
    });
    expect(w.messages).toHaveLength(100);
    expect(w.messages[0]!.id).toBe('m0001');
    expect(w.hasOlder).toBe(false);
    // An older page says nothing about changes to the rows already in the window.
    expect(w.lastSeq).toBe(start.lastSeq);
  });

  it('loading older past 300 drops the newest and sets hasNewer', () => {
    let w = loaded(range(301, 350), { hasMore: true });
    for (let top = 300; top > 0; top -= 50) {
      w = windowReducer(w, {
        type: 'loadedOlder',
        page: latestPage(range(top - 49, top), { hasMore: top > 50 }),
      });
    }
    expect(w.messages).toHaveLength(MAX_IN_MEMORY);
    expect(w.messages[0]!.id).toBe('m0001');
    expect(w.messages.at(-1)!.id).toBe('m0300');
    expect(w).toMatchObject({ hasOlder: false, hasNewer: true });
  });

  it('new rows past 300 drop the oldest and set hasOlder', () => {
    let w = loaded(range(1, 50));
    for (let n = 51; n <= 301; n += 1) w = windowReducer(w, { type: 'upsert', messages: [msg(n)] });
    expect(w.messages).toHaveLength(MAX_IN_MEMORY);
    expect(w.messages[0]!.id).toBe('m0002');
    expect(w.messages.at(-1)!.id).toBe('m0301');
    expect(w).toMatchObject({ hasOlder: true, hasNewer: false });
  });

  it('loadedNewer appends a page and past 300 drops the oldest', () => {
    let w = windowReducer(initialWindow, {
      type: 'loadedAround',
      page: {
        messages: range(1, 280),
        hasOlder: false,
        hasNewer: true,
        targetId: 'm0001',
        lastSeq: 400,
        lastReadAt: null,
      },
    });
    w = windowReducer(w, {
      type: 'loadedNewer',
      page: { messages: range(280, 330), hasMore: true, lastSeq: 500, lastReadAt: null },
    });
    expect(w.messages).toHaveLength(MAX_IN_MEMORY);
    expect(w.messages[0]!.id).toBe('m0031');
    expect(w.messages.at(-1)!.id).toBe('m0330');
    expect(w).toMatchObject({ hasOlder: true, hasNewer: true, lastSeq: 400 });
  });

  it('the unread anchor stays at the first load while the read cursor moves', () => {
    const first = loaded(range(1, 3), { lastReadAt: '2026-10-15T10:00:01.000Z' });
    let w = windowReducer(first, { type: 'readMarked', at: '2026-10-15T10:00:03.000Z' });
    expect(w.lastReadAt).toBe('2026-10-15T10:00:03.000Z');
    w = windowReducer(w, {
      type: 'loadedLatest',
      page: latestPage(range(1, 4), { lastReadAt: '2026-10-15T10:00:04.000Z' }),
    });
    expect(w.lastReadAt).toBe('2026-10-15T10:00:04.000Z');
    expect(w.unreadAnchor).toBe('2026-10-15T10:00:01.000Z');
    // A read cursor never moves back.
    w = windowReducer(w, { type: 'readMarked', at: '2026-10-15T10:00:00.000Z' });
    expect(w.lastReadAt).toBe('2026-10-15T10:00:04.000Z');
  });

  it('a loaded page removes the pending rows it already contains', () => {
    const sending = windowReducer(loaded(range(1, 2)), { type: 'pendingAdded', input: input('x') });
    const w = windowReducer(sending, {
      type: 'loadedLatest',
      page: latestPage([...range(1, 2), msg(3, { clientId: 'x' })]),
    });
    expect(w.pending).toEqual([]);
  });

  it('reset returns the empty, unloaded window', () => {
    expect(windowReducer(loaded(range(1, 2)), { type: 'reset' })).toBe(initialWindow);
  });
});

describe('upsertIntoThread', () => {
  const thread = (): Thread => ({
    root: msg(1, { replyCount: 1 }),
    replies: [msg(2, { parentId: 'm0001' })],
  });

  it('adds a new reply in order and updates an edited one', () => {
    let t = upsertIntoThread(thread(), msg(3, { parentId: 'm0001' }));
    t = upsertIntoThread(t, msg(2, { parentId: 'm0001', body: 'edited', changeSeq: 9 }));
    expect(t.replies.map((r) => [r.id, r.body])).toEqual([
      ['m0002', 'edited'],
      ['m0003', 'message 3'],
    ]);
  });

  it('updates the root and ignores older versions and foreign messages', () => {
    const start = thread();
    const t = upsertIntoThread(start, msg(1, { replyCount: 2, changeSeq: 5 }));
    expect(t.root.replyCount).toBe(2);
    expect(upsertIntoThread(t, msg(1, { replyCount: 1, changeSeq: 4 }))).toBe(t);
    expect(upsertIntoThread(t, msg(2, { parentId: 'm0001', changeSeq: 1 }))).toBe(t);
    expect(upsertIntoThread(t, msg(7, { parentId: 'other' }))).toBe(t);
  });
});
