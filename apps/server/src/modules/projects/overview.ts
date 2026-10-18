import { ACTIVE_CARD_ROWS, type ActiveCards } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { openTasksOf } from '../tasks/open-of-group.js';
import { activeTicketsOf } from '../tickets/active-of-group.js';
import { getUserNames } from '../users/service.js';
import { projectRefs } from './refs.js';

/**
 * The overview's active cards (Phase 33 part P4, spec §7.4, decision 18): the client's open tasks
 * and active tickets, the caller's own first, 8 rows each, from the tasks and tickets modules.
 * Four queries: the two cards, the rows' project refs and the assignees' names.
 */
export async function getActiveCards(
  db: Db,
  groupId: string,
  userId: string,
): Promise<ActiveCards> {
  const [tasks, tickets] = await Promise.all([
    openTasksOf(db, groupId, userId, ACTIVE_CARD_ROWS),
    activeTicketsOf(db, groupId, userId, ACTIVE_CARD_ROWS),
  ]);
  const [refs, names] = await Promise.all([
    projectRefs(db, [...tasks.rows, ...tickets.rows]),
    getUserNames(db, [...new Set(tasks.rows.flatMap((r) => r.assigneeIds))]),
  ]);
  return {
    tasks: {
      total: tasks.total,
      mine: tasks.mine,
      urgent: tasks.urgent,
      rows: tasks.rows.map((r) => ({
        id: r.id,
        title: r.title,
        dueDate: r.dueDate,
        urgent: r.urgent,
        mine: r.mine,
        assignees: r.assigneeIds.map((id) => ({ id, name: names.get(id) ?? '' })),
        project: refs.project(r.projectId),
        event: refs.event(r.eventId),
      })),
    },
    tickets: {
      total: tickets.total,
      mine: tickets.mine,
      rows: tickets.rows.map((r) => ({
        id: r.id,
        number: r.number,
        subject: r.subject,
        status: r.status,
        createdAt: r.createdAt,
        mine: r.mine,
        project: refs.project(r.projectId),
        event: refs.event(r.eventId),
      })),
    },
  };
}
