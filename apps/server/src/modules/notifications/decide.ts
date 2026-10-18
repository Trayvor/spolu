import {
  wantsEmail,
  wantsPush,
  type GroupMode,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationKind,
} from '@spolu/shared';

/**
 * The spec's mode filter: plain messages and meeting scheduling need "all"; everything else also
 * passes "mentions"; reminders, ticket board events and an AI meeting result pass "off" too.
 * `modules/notifications/follows.ts` mirrors it in SQL for the dashboard: change both together.
 */
export function passesMode(
  kind: NotificationKind,
  group: NotificationCategory,
  mode: GroupMode,
): boolean {
  // Ticket events go to the ticket's riešitelia (or its watchers while it has none) and its
  // initiator, by explicit choices: only the tickets channel decides. A reminder was set for this person (or by them) on purpose, likewise, and an
  // AI meeting result goes only to the admin who started the run. A time request (Phase 32) is
  // a direct request to one person, like a reminder.
  if (group === 'tickets' || DIRECT.has(kind) || AI_RESULT.has(kind)) return true;
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return !ALL_ONLY.has(kind);
}

/** Kinds that only All messages lets through (2026-10-17: a meeting's scheduling too). */
const ALL_ONLY = new Set<NotificationKind>([
  'chat.message',
  'meeting.scheduled',
  'meeting.rescheduled',
]);
const DIRECT = new Set<NotificationKind>([
  'reminder.due',
  'task.time_missing',
  'ticket.time_missing',
]);
const AI_RESULT = new Set<NotificationKind>(['meeting.summary_ready', 'meeting.summary_failed']);

/** A user gets one notification per message; the strongest kind wins. */
export const KIND_RANK: Record<NotificationKind, number> = {
  'chat.message': 1,
  'chat.mention': 2,
  'chat.thread_reply': 2,
  'task.moved': 2,
  'task.assigned': 2,
  'task.deadline': 2,
  'task.urgent': 2,
  'task.due_changed': 2,
  'task.overdue': 2,
  'reminder.due': 2,
  'task.time_missing': 2,
  // A ticket chat message ranks like a chat message: a mention of the same message wins.
  'ticket.message': 1,
  'ticket.created': 2,
  'ticket.unassigned': 2,
  'ticket.status': 2,
  'ticket.updated': 2,
  'ticket.tasks': 2,
  'ticket.assigned': 2,
  'ticket.resolved': 2,
  'ticket.time_missing': 2,
  'meeting.scheduled': 2,
  'meeting.rescheduled': 2,
  'meeting.summary_ready': 2,
  'meeting.summary_failed': 2,
  'description.mention': 2,
};

type Ranked = { id: string; kind: NotificationKind };

/** Siblings are the other events of the same user and message. Equal rank keeps the smaller id. */
export function isOutranked(event: Ranked, siblings: Ranked[]): boolean {
  return siblings.some((s) => {
    if (s.id === event.id) return false;
    const diff = KIND_RANK[s.kind] - KIND_RANK[event.kind];
    return diff > 0 || (diff === 0 && s.id < event.id);
  });
}

export type DecisionInput = {
  kind: NotificationKind;
  mode: GroupMode;
  isGroupPerson: boolean;
  unread: boolean;
  outranked: boolean;
  /** The event's notification group and the user's channel for it. */
  group: NotificationCategory;
  channel: NotificationChannel;
  /** The server has push configured. */
  pushAvailable: boolean;
  hasSubscriptions: boolean;
};

export function decideEvent(i: DecisionInput): { push: boolean; email: boolean } {
  if (!(i.isGroupPerson && i.unread && !i.outranked && passesMode(i.kind, i.group, i.mode))) {
    return { push: false, email: false };
  }
  return {
    push: wantsPush(i.channel) && i.pushAvailable && i.hasSubscriptions,
    email: wantsEmail(i.channel),
  };
}
