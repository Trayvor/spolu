import {
  NotificationCategories,
  type NotificationCategory,
  type NotificationKind,
  type SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { activeMemberIds, isRequesterOnly } from '../groups/memberships.js';
import { listGroupPeople } from '../groups/service.js';

/**
 * The notification group of every event kind: the one place that maps a kind to a group. A new
 * kind is added here, and `notificationGroupOf` refines three cases by payload.
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
  'ticket.created': 'tickets',
  'ticket.unassigned': 'tickets',
  'ticket.message': 'tickets',
  'ticket.status': 'tickets',
  'ticket.updated': 'tickets',
  'ticket.tasks': 'tickets',
  'ticket.assigned': 'tickets',
};

/**
 * The group an event belongs to: a ticket chat event (a mention, Phase 21) is the ticket board's,
 * a task chat message the task board's, a Knowledge base reminder the knowledge base's. A kind that is not in the map (an old row of a removed kind)
 * gives null; callers treat such an event as deliverable to no one, never as an error.
 */
export function notificationGroupOf(
  kind: string,
  payload: Record<string, unknown>,
): NotificationCategory | null {
  if (!Object.hasOwn(NOTIFICATION_GROUP_OF, kind)) return null;
  const group = NOTIFICATION_GROUP_OF[kind as NotificationKind];
  if (group === 'chat' && typeof payload.ticketId === 'string' && payload.ticketId !== '') {
    return 'tickets';
  }
  if (group === 'chat' && typeof payload.taskId === 'string' && payload.taskId !== '') {
    return 'tasks';
  }
  if (kind === 'reminder.due' && payload.subjectKind === 'knowledge') return 'knowledge';
  return group;
}

/**
 * The groups the user can set (and the profile shows): all four, except for a requester-only
 * person (not an admin, no active client membership, Phase 21), who has only `tickets`.
 */
export async function visibleCategoriesFor(
  db: Db,
  user: SessionUser,
): Promise<NotificationCategory[]> {
  return (await isRequesterOnly(db, user)) ? ['tickets'] : [...NotificationCategories];
}

/**
 * Who belongs to the event's client group for delivery: the group's people (its clients and every
 * admin); for `tickets` also its `ziadatel` members (Phase 21), who belong to no other group.
 */
export async function notificationAudience(
  db: Db,
  groupId: string,
  group: NotificationCategory,
): Promise<Set<string>> {
  const people = new Set((await listGroupPeople(db, groupId)).map((p) => p.id));
  if (group === 'tickets') {
    for (const id of await activeMemberIds(db, groupId, 'ziadatel')) people.add(id);
  }
  return people;
}
