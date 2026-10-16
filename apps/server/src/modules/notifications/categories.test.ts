import { describe, expect, it } from 'vitest';
import { NotificationKinds } from '@spolu/shared';
import { NOTIFICATION_GROUP_OF, notificationGroupOf } from './categories.js';

describe('notificationGroupOf', () => {
  it.each([
    ['chat.message', {}, 'chat'],
    ['chat.mention', {}, 'chat'],
    ['chat.thread_reply', {}, 'chat'],
    ['chat.message', { taskId: 't1' }, 'tasks'],
    ['chat.mention', { taskId: 't1' }, 'tasks'],
    ['chat.thread_reply', { taskId: 't1' }, 'tasks'],
    ['chat.mention', { taskId: '' }, 'chat'],
    ['chat.mention', { taskId: null }, 'chat'],
    ['task.moved', {}, 'tasks'],
    ['task.assigned', {}, 'tasks'],
    ['task.deadline', {}, 'tasks'],
    ['task.urgent', {}, 'tasks'],
    ['reminder.due', { subjectKind: 'task', taskId: 't1' }, 'tasks'],
    ['reminder.due', { subjectKind: 'knowledge' }, 'knowledge'],
  ] as const)('%s %j -> %s', (kind, payload, group) => {
    expect(notificationGroupOf(kind, payload)).toBe(group);
  });

  it('an unknown kind has no group and does not throw', () => {
    expect(notificationGroupOf('ticket.created', {})).toBeNull();
    expect(notificationGroupOf('', {})).toBeNull();
    expect(notificationGroupOf('toString', {})).toBeNull();
  });

  it('the map covers every kind', () => {
    expect(Object.keys(NOTIFICATION_GROUP_OF).sort()).toEqual([...NotificationKinds].sort());
  });
});
