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
    ).toEqual({ line: 'Jana: hello', url: chatUrl, button: 'Open Firma', topic: 'Firma' });
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
      button: 'Open Firma',
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

  it('an event of a non-ticket group without a client group gives null', () => {
    expect(
      digestEntry(
        { kind: 'chat.message', payload: { authorName: 'Jana', excerpt: 'x' } },
        { ...ctx, groupId: null, groupName: null },
      ),
    ).toBeNull();
  });

  it('an unknown kind gives null', () => {
    expect(digestEntry({ kind: 'ticket.created', payload: {} }, ctx)).toBeNull();
  });
});
