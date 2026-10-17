import { sql, type SQL } from 'drizzle-orm';
import type { GroupMode, NotificationCategory } from '@spolu/shared';
import { channelSql } from '../users/service.js';

/**
 * What a user follows, as SQL fragments for other modules' single statements: the dashboard shows
 * only what the person was, or would be, notified about (2026-10-17, see
 * docs/superpowers/specs/2026-10-17-dashboard-follows-notifications-design.md). Each fragment
 * mirrors a delivery rule: `effectiveGroupMode` (per-group choice, else the user's default, else
 * the role's), `passesMode`, `notificationGroupOf` and `recordNotifications` skipping a `none`
 * channel. The notification tables stay this module's own.
 */

/**
 * The user's effective mode for the group `groupId` (an SQL expression, e.g. `g.id`). The user's
 * default and role are read once per statement (an uncorrelated subquery); the per-group choice is
 * one primary key lookup of `group_notification_settings` per row.
 */
export function groupModeSql(userId: string, groupId: SQL): SQL<GroupMode> {
  return sql<GroupMode>`coalesce(
    (select s.mode from group_notification_settings s
      where s.user_id = ${userId} and s.group_id = ${groupId}),
    (select coalesce(u.default_group_mode, case when u.role = 'client' then 'all' else 'mentions' end)
      from "user" u where u.id = ${userId})
  )`;
}

/** True when the user's channel for `category` is not `none` (read once per statement). */
export function channelOnSql(userId: string, category: NotificationCategory): SQL<boolean> {
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
