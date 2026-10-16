import { describe, expect, it } from 'vitest';
import type { MentionItem } from '@spolu/shared';
import { mentionTarget } from './cards';

const mention = (over: Partial<MentionItem>): MentionItem => ({
  messageId: 'm1',
  channelId: 'c1',
  taskId: null,
  ticketId: null,
  parentId: null,
  groupId: 'g1',
  groupName: 'ABC',
  authorName: 'Eva',
  excerpt: 'Hi',
  createdAt: '2026-10-16T10:00:00.000Z',
  ...over,
});

describe('mentionTarget', () => {
  it('a mention in a ticket chat opens the ticket page at the message', () => {
    expect(mentionTarget(mention({ ticketId: 'k1', parentId: 'r1' }))).toEqual({
      to: '/tickets/$ticketId',
      params: { ticketId: 'k1' },
      search: { thread: 'r1', message: 'm1', c: 'c1' },
    });
  });

  it('a group chat mention opens the Chat tab', () => {
    expect(mentionTarget(mention({}))).toEqual({
      to: '/groups/$groupId/chat',
      params: { groupId: 'g1' },
      search: { message: 'm1', c: 'c1' },
    });
  });
});
