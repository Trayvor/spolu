import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { GroupKind, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { isGroupManager, managedGroupsSql } from '../groups/managers.js';
import { listGroupPeople } from '../groups/service.js';
import { isAdmin } from '../users/policy.js';
import { canHoldTickets } from './policy.js';
import { ticketWatchSettings } from './schema.js';

/**
 * "Watch tickets" (Sledovať tikety): who hears about a client group's new tickets. A user's own
 * choice (a row) wins; without one the default is on for the group's clients and its managers and
 * off for every other admin. So becoming a manager turns it on by itself, stopping turns it off
 * again, and a choice the user made stays either way (the same idea as the manager's notification
 * mode, origin "manager", in `notifications/modes.ts`, but derived instead of stored).
 */

/** Whether the actor watches the group's tickets. The caller checked `canWatchTickets`. */
export async function watchesTickets(
  db: Db,
  actor: SessionUser,
  groupId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ watching: ticketWatchSettings.watching })
    .from(ticketWatchSettings)
    .where(and(eq(ticketWatchSettings.userId, actor.id), eq(ticketWatchSettings.groupId, groupId)));
  if (row) return row.watching;
  return isAdmin(actor) ? isGroupManager(db, groupId, actor.id) : true;
}

/** Saves the user's own choice for the group (an upsert). */
export async function setTicketWatch(
  db: Db,
  userId: string,
  groupId: string,
  watching: boolean,
): Promise<void> {
  await db
    .insert(ticketWatchSettings)
    .values({ userId, groupId, watching })
    .onConflictDoUpdate({
      target: [ticketWatchSettings.userId, ticketWatchSettings.groupId],
      set: { watching },
    });
}

/**
 * The people who watch the group's tickets: of its readers (named active clients and active
 * admins, `listGroupPeople`), those whose choice or default says on. Two queries.
 */
export async function ticketWatcherIds(db: Db, groupId: string): Promise<string[]> {
  const [people, rows] = await Promise.all([
    listGroupPeople(db, groupId),
    db
      .select({ userId: ticketWatchSettings.userId, watching: ticketWatchSettings.watching })
      .from(ticketWatchSettings)
      .where(eq(ticketWatchSettings.groupId, groupId)),
  ]);
  const choice = new Map(rows.map((r) => [r.userId, r.watching]));
  return people.filter((p) => choice.get(p.id) ?? (!p.isAdmin || p.isManager)).map((p) => p.id);
}

/**
 * The groups an admin watches, as a parenthesized subquery for one-statement queries (the
 * dashboard): the groups they chose to watch, and the groups they manage unless they chose not
 * to. Served by the primary key and `group_managers_user_id_idx`.
 */
export function watchedGroupsSql(userId: string): SQL {
  return sql`(
    select w.group_id from ticket_watch_settings w where w.user_id = ${userId} and w.watching
    union
    select m.group_id from ${managedGroupsSql(userId)} m
    where not exists (select 1 from ticket_watch_settings o
      where o.user_id = ${userId} and o.group_id = m.group_id and not o.watching)
  )`;
}

/**
 * `watchesTickets` for many groups at once (the client table of `/settings/notifications`, UX
 * review X7): the actor's choice, else on for a client and for an admin who manages the group
 * (`managed`, the caller's set). Groups that cannot hold tickets (the admin group) are null.
 * One query. The caller checked the actor may read every group.
 */
export async function watchStatesFor(
  db: Db,
  actor: SessionUser,
  groupList: { id: string; kind: GroupKind }[],
  managed: ReadonlySet<string>,
): Promise<Map<string, boolean | null>> {
  const result = new Map<string, boolean | null>();
  const holders = groupList.filter((g) => canHoldTickets(g));
  for (const g of groupList) if (!canHoldTickets(g)) result.set(g.id, null);
  if (holders.length === 0) return result;
  const rows = await db
    .select({ groupId: ticketWatchSettings.groupId, watching: ticketWatchSettings.watching })
    .from(ticketWatchSettings)
    .where(
      and(
        eq(ticketWatchSettings.userId, actor.id),
        inArray(
          ticketWatchSettings.groupId,
          holders.map((g) => g.id),
        ),
      ),
    );
  const choice = new Map(rows.map((r) => [r.groupId, r.watching]));
  for (const g of holders) {
    result.set(g.id, choice.get(g.id) ?? (isAdmin(actor) ? managed.has(g.id) : true));
  }
  return result;
}
