import { sql, type SQL } from 'drizzle-orm';
import type { GroupMode, NotificationCategory } from '@spolu/shared';
import { channelSql } from '../users/service.js';

/**
 * What a user follows, as SQL fragments for other modules' single statements: the dashboard shows
 * only what the person was, or would be, notified about (2026-10-17, see
 * docs/superpowers/specs/2026-10-17-dashboard-follows-notifications-design.md). Each fragment
 * mirrors a delivery rule: `effectiveGroupMode` (per-group choice, else `all` in the admin group,
 * else the user's default, else the role's), `passesMode`, `notificationGroupOf` and `recordNotifications` skipping a `none`
 * channel. The notification tables stay this module's own.
 */

/**
 * The user's effective mode for the group `groupId` (an SQL expression, e.g. `g.id`). The user's
 * default and role are read once per statement (an uncorrelated subquery); the per-group choice is
 * one primary key lookup of `group_notification_settings` per row.
 *
 * `userId` is a user id (bound as a parameter) or an SQL expression naming one (2026-10-19: a
 * lateral join's `wa.id`, the admin workload card); then the user's row is read once per outer row.
 */
export function groupModeSql(userId: string | SQL, groupId: SQL): SQL<GroupMode> {
  return sql<GroupMode>`coalesce(
    (select s.mode from group_notification_settings s
      where s.user_id = ${userId} and s.group_id = ${groupId}),
    (select 'all' from groups ag where ag.id = ${groupId} and ag.kind = 'admin'),
    (select coalesce(u.default_group_mode, case when u.role = 'client' then 'all' else 'mentions' end)
      from "user" u where u.id = ${userId})
  )`;
}

/**
 * `groupModeSql` as joins (2026-10-19), for a statement that needs the mode of thousands of rows:
 * a hash join each instead of up to three subqueries per row (the unseen tasks of an admin read
 * 12 000 events). Put `joins` after the `from` item that `groupId` reads, and read `mode`. Every
 * row stays (left joins); for an unknown user the mode is null, as `groupModeSql` gives. The
 * aliases are `gm_u`, `gm_s` and `gm_a`.
 */
export function groupModeJoinsSql(
  userId: string | SQL,
  groupId: SQL,
): { joins: SQL; mode: SQL<GroupMode> } {
  return {
    joins: sql`
      left join (
        select coalesce(u.default_group_mode, case when u.role = 'client' then 'all' else 'mentions' end)
          as mode
        from "user" u where u.id = ${userId}
      ) gm_u on true
      left join group_notification_settings gm_s
        on gm_s.user_id = ${userId} and gm_s.group_id = ${groupId}
      left join groups gm_a on gm_a.id = ${groupId} and gm_a.kind = 'admin'`,
    mode: sql<GroupMode>`coalesce(gm_s.mode, case when gm_a.id is not null then 'all' end, gm_u.mode)`,
  };
}

/**
 * True when the user's channel for `category` is not `none` (read once per statement). `userId`
 * is a user id or an SQL expression naming one, as in `groupModeSql`.
 */
export function channelOnSql(userId: string | SQL, category: NotificationCategory): SQL<boolean> {
  return sql<boolean>`coalesce(
    (select ${channelSql('u', category)} <> 'none' from "user" u where u.id = ${userId}),
    false
  )`;
}

/**
 * Whether a mention in a chat would notify the user: a ticket chat's (`ticketId` not null) by the
 * ticket board channel alone (ticket events pass every mode); a task chat's (`taskId` not null)
 * by the task board channel and a mode that is not Off; a group chat's by the chat channel and a
 * mode that is not Off.
 */
export function mentionNotifiesSql(
  userId: string,
  refs: { groupId: SQL; taskId: SQL; ticketId: SQL },
): SQL<boolean> {
  const notOff = sql`${groupModeSql(userId, refs.groupId)} <> 'off'`;
  return sql<boolean>`(case
    when ${refs.ticketId} is not null then ${channelOnSql(userId, 'tickets')}
    when ${refs.taskId} is not null then ${channelOnSql(userId, 'tasks')} and ${notOff}
    else ${channelOnSql(userId, 'chat')} and ${notOff}
  end)`;
}

/**
 * Whether a mention in a description (`description.mention`, F16) would notify the user: a
 * ticket's by the ticket board channel alone (ticket events pass every mode); a knowledge item's
 * by the knowledge base channel and a mode that is not Off; a task's or a project's by the task
 * board channel and a mode that is not Off (`notificationGroupOf`, `passesMode`).
 */
export function descriptionMentionNotifiesSql(
  userId: string,
  refs: { groupId: SQL; subjectKind: SQL },
): SQL<boolean> {
  const notOff = sql`${groupModeSql(userId, refs.groupId)} <> 'off'`;
  return sql<boolean>`(case ${refs.subjectKind}
    when 'ticket' then ${channelOnSql(userId, 'tickets')}
    when 'knowledge' then ${channelOnSql(userId, 'knowledge')} and ${notOff}
    else ${channelOnSql(userId, 'tasks')} and ${notOff}
  end)`;
}

/**
 * Whether the group chat of `groupId` notifies the user at all: the chat channel is not `none`
 * and the group's mode is not Off (Mentions and replies still notifies mentions and replies).
 */
export function groupChatNotifiesSql(userId: string, groupId: SQL): SQL<boolean> {
  return sql<boolean>`(${channelOnSql(userId, 'chat')} and ${groupModeSql(userId, groupId)} <> 'off')`;
}

/**
 * Whether a meeting of `groupId` notifies the user: the meetings channel is not `none`, and either
 * the group's mode is All messages (scheduling and rescheduling pass only All) or `reminded` (the
 * user gets the meeting's reminder, which passes every mode).
 */
export function meetingNotifiesSql(userId: string, groupId: SQL, reminded: SQL): SQL<boolean> {
  return sql<boolean>`(${channelOnSql(userId, 'meetings')}
    and (${groupModeSql(userId, groupId)} = 'all' or ${reminded}))`;
}
