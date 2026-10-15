import { describe, expect, it } from 'vitest';
import { chatMessageHref } from './links';

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
