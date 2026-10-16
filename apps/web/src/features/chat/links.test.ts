import { describe, expect, it } from 'vitest';
import { chatMessageHref, chatMessageLocation } from './links';

describe('chatMessageHref', () => {
  it('links a group chat message into the Chat tab', () => {
    expect(chatMessageHref('g', { messageId: 'm', channelId: 'c', taskId: null })).toBe(
      '/groups/g/chat?message=m&c=c',
    );
  });

  it("links a task chat message into the task panel's Chat tab", () => {
    expect(chatMessageHref('g', { messageId: 'm', channelId: 'c', taskId: 't' })).toBe(
      '/groups/g/tasks/t?tab=chat&message=m&c=c',
    );
  });

  it('encodes every part', () => {
    expect(chatMessageHref('g/1', { messageId: 'm&1', channelId: 'c 1', taskId: 't?1' })).toBe(
      '/groups/g%2F1/tasks/t%3F1?tab=chat&message=m%261&c=c%201',
    );
  });
});

describe('chatMessageLocation', () => {
  it('points a group chat message at the Chat tab', () => {
    expect(chatMessageLocation('g', { messageId: 'm', channelId: 'c', taskId: null })).toEqual({
      to: '/groups/$groupId/chat',
      params: { groupId: 'g' },
      search: { message: 'm', c: 'c' },
    });
  });

  it("points a task chat message at the task panel's Chat tab", () => {
    expect(chatMessageLocation('g', { messageId: 'm', channelId: 'c', taskId: 't' })).toEqual({
      to: '/groups/$groupId/tasks/$taskId',
      params: { groupId: 'g', taskId: 't' },
      search: { tab: 'chat', message: 'm', c: 'c' },
    });
  });

  it('points a ticket chat message at the ticket page', () => {
    const m = { messageId: 'm', channelId: 'c', taskId: null, ticketId: 'k' };
    expect(chatMessageLocation('g', m)).toEqual({
      to: '/tickets/$ticketId',
      params: { ticketId: 'k' },
      search: { message: 'm', c: 'c' },
    });
    expect(chatMessageHref('g', m)).toBe('/tickets/k?message=m&c=c');
  });
});
