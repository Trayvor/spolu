import {
  NotificationCategories,
  type NotificationCategory,
  type NotificationKind,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { listGroupPeople } from '../groups/service.js';

/**
 * The notification group of every event kind: the one place that maps a kind to a group. A new
 * kind (item B's `ticket.*`) is added here, and `notificationGroupOf` refines two cases by payload.
 */
export const NOTIFICATION_GROUP_OF: Record<NotificationKind, NotificationCategory> = {
  'chat.message': 'chat',
  'chat.mention': 'chat',
  'chat.thread_reply': 'chat',
  'task.moved': 'tasks',
  'task.assigned': 'tasks',
  'task.deadline': 'tasks',
  'task.urgent': 'tasks',
  'reminder.due': 'tasks',
};

/**
 * The group an event belongs to: a task chat message is the task board's, a Knowledge base
 * reminder the knowledge base's. A kind that is not in the map (an old row of a removed kind)
 * gives null; callers treat such an event as deliverable to no one, never as an error.
 */
export function notificationGroupOf(
  kind: string,
  payload: Record<string, unknown>,
): NotificationCategory | null {
  if (!Object.hasOwn(NOTIFICATION_GROUP_OF, kind)) return null;
  const group = NOTIFICATION_GROUP_OF[kind as NotificationKind];
  if (group === 'chat' && typeof payload.taskId === 'string' && payload.taskId !== '') {
    return 'tasks';
  }
  if (kind === 'reminder.due' && payload.subjectKind === 'knowledge') return 'knowledge';
  return group;
}

/**
 * The groups the user can set (and the profile shows): all of them for everyone today. Item B-1
 * narrows this to `['tickets']` for a requester-only user (not an admin, no active client
 * membership).
 */
// The parameters are item B-1's (it reads the user's memberships); unused until then.
/* eslint-disable @typescript-eslint/no-unused-vars */
export async function visibleCategoriesFor(
  _db: Db,
  _user: { id: string },
): Promise<NotificationCategory[]> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return [...NotificationCategories];
}

/**
 * Who belongs to the event's client group for delivery: the group's people (its clients and every
 * admin) for every group today. Item B-1 changes only this: for `tickets`, members with the
 * `ziadatel` role count too; for every other group they do not.
 */
export async function notificationAudience(
  db: Db,
  groupId: string,
  // Item B-1's (it widens the audience for `tickets`); unused until then.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _group: NotificationCategory,
): Promise<Set<string>> {
  return new Set((await listGroupPeople(db, groupId)).map((p) => p.id));
}
