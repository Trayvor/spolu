import { describe, expect, it } from 'vitest';
import type { MessageDto } from '@spolu/shared';
import { buildRows } from './message-rows';

const ME = 'me';
let n = 0;
function msg(over: Partial<MessageDto> & { at: Date }): MessageDto {
  n += 1;
  const { at, ...rest } = over;
  return {
    id: `m${n}`,
    channelId: 'c1',
    parentId: null,
    replyToId: null,
    author: { id: 'anna', name: 'Anna', isAdmin: false },
    body: 'hi',
    mentions: [],
    mentionsAll: false,
    attachments: [],
    clientId: null,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: at.toISOString(),
    changeSeq: n,
    tasks: [],
    reactions: [],
    knowledge: [],
    ...rest,
  };
}
const at = (day: number, h: number, min = 0) => new Date(2026, 9, day, h, min);
const opts = { lastReadAt: at(1, 0).toISOString(), meId: ME, now: at(15, 12) };
const messages = (rows: ReturnType<typeof buildRows>) =>
  rows.flatMap((r) => (r.kind === 'message' ? [r] : []));

describe('buildRows', () => {
  it('without a read cursor (thread panel) there is no new line', () => {
    const rows = buildRows([msg({ at: at(14, 9) })], { ...opts, lastReadAt: undefined });
    expect(rows.map((r) => r.kind)).toEqual(['day', 'message']);
  });

  it('same author within 5 minutes hides the header', () => {
    const rows = messages(buildRows([msg({ at: at(14, 9) }), msg({ at: at(14, 9, 4) })], opts));
    expect(rows.map((r) => r.showHeader)).toEqual([true, false]);
  });

  it('6 minutes apart or another author shows it', () => {
    const rows = messages(
      buildRows(
        [
          msg({ at: at(14, 9) }),
          msg({ at: at(14, 9, 6) }),
          msg({ at: at(14, 9, 7), author: { id: 'bo', name: 'Bo', isAdmin: false } }),
        ],
        opts,
      ),
    );
    expect(rows.map((r) => r.showHeader)).toEqual([true, true, true]);
  });

  it('day divider between days', () => {
    const rows = buildRows([msg({ at: at(14, 23, 59) }), msg({ at: at(15, 0, 1) })], {
      ...opts,
      lastReadAt: at(16, 0).toISOString(),
    });
    expect(rows.map((r) => r.kind)).toEqual(['day', 'message', 'day', 'message']);
    expect(messages(rows)[1]!.showHeader).toBe(true);
  });

  it('new line before the first unread message by someone else', () => {
    const lastReadAt = at(14, 10).toISOString();
    const mine = msg({ at: at(14, 10, 30), author: { id: ME, name: 'Me', isAdmin: false } });
    const rows = buildRows(
      [msg({ at: at(14, 9) }), mine, msg({ at: at(14, 11) }), msg({ at: at(14, 12) })],
      { ...opts, lastReadAt },
    );
    expect(rows.map((r) => r.kind)).toEqual([
      'day',
      'message',
      'message',
      'new',
      'message',
      'message',
    ]);
    expect(messages(rows)[2]!.showHeader).toBe(true);
  });

  it('new line goes before the first message by someone else when nothing was read', () => {
    const rows = buildRows([msg({ at: at(14, 9) })], { ...opts, lastReadAt: null });
    expect(rows.map((r) => r.kind)).toEqual(['day', 'new', 'message']);
  });

  it('no new line when everything is read', () => {
    const rows = buildRows([msg({ at: at(14, 9) })], {
      ...opts,
      lastReadAt: at(14, 10).toISOString(),
    });
    expect(rows.some((r) => r.kind === 'new')).toBe(false);
  });

  it('mentionsMe for @all and for my id, not for my own message', () => {
    const own = { id: ME, name: 'Me', isAdmin: false };
    const rows = messages(
      buildRows(
        [
          msg({ at: at(14, 9), mentionsAll: true }),
          msg({ at: at(14, 10), mentions: [ME] }),
          msg({ at: at(14, 11), mentions: ['bo'] }),
          msg({ at: at(14, 12), mentionsAll: true, author: own }),
        ],
        opts,
      ),
    );
    expect(rows.map((r) => r.mentionsMe)).toEqual([true, true, false, false]);
  });
});
