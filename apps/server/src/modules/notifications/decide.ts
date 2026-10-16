import type { GroupMode, NotificationKind } from '@spolu/shared';

/** The spec's mode filter: plain messages need "all"; everything else also passes "mentions"; reminders pass "off" too. */
export function passesMode(kind: NotificationKind, mode: GroupMode): boolean {
  // A reminder was set for this person (or by them) on purpose, so no mode silences it.
  if (kind === 'reminder.due') return true;
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return kind !== 'chat.message';
}

/** A user gets one notification per message; the strongest kind wins. */
export const KIND_RANK: Record<NotificationKind, number> = {
  'chat.message': 1,
  'chat.mention': 2,
  'chat.thread_reply': 2,
  'task.moved': 2,
  'task.assigned': 2,
  'task.deadline': 2,
  'task.urgent': 2,
  'reminder.due': 2,
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
  pushEnabled: boolean;
  emailEnabled: boolean;
  hasSubscriptions: boolean;
};

export function decideEvent(i: DecisionInput): { push: boolean; email: boolean } {
  if (!(i.isGroupPerson && i.unread && !i.outranked && passesMode(i.kind, i.mode))) {
    return { push: false, email: false };
  }
  return { push: i.pushEnabled && i.hasSubscriptions, email: i.emailEnabled };
}
