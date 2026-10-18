import {
  BucketLabelSchema,
  TicketStatusSchema,
  UNSEEN_SUMMARY_LINES,
  type BucketLabel,
  type UnseenSummary,
  type UnseenSummaryLine,
} from '@spolu/shared';

/** One of the viewer's unseen events of a task or ticket; `day` is its date in Bratislava. */
export type UnseenEventRow = {
  kind: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  day: string;
};

/** Authors named on a messages or mentions line. */
const MAX_AUTHORS = 3;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const bucket = (v: unknown): BucketLabel | null => BucketLabelSchema.safeParse(v).data ?? null;

/** `YYYY-MM-DD` plus `n` days. */
function addDays(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** Which line an event kind adds to, if any. */
function lineKind(kind: string): UnseenSummaryLine['kind'] | null {
  switch (kind) {
    case 'ticket.created':
    case 'ticket.unassigned':
      return 'created';
    case 'task.moved':
      return 'moved';
    case 'task.assigned':
    case 'ticket.assigned':
      return 'assigned';
    case 'task.deadline':
      return 'deadline';
    case 'task.due_changed':
      return 'dueChanged';
    case 'task.overdue':
      return 'overdue';
    case 'chat.message':
    case 'chat.thread_reply':
    case 'ticket.message':
      return 'messages';
    case 'chat.mention':
    case 'description.mention':
      return 'mentions';
    case 'ticket.status':
    case 'ticket.resolved':
      return 'status';
    case 'ticket.updated':
      return 'updated';
    case 'ticket.tasks':
      return 'tasks';
    case 'ticket.time_missing':
      return 'timeMissing';
    default:
      return null;
  }
}

/** The line of one kind from its events, newest first; null when they say nothing readable. */
function buildLine(
  kind: UnseenSummaryLine['kind'],
  events: UnseenEventRow[],
): UnseenSummaryLine | null {
  const newest = events[0]!;
  switch (kind) {
    case 'moved':
      return {
        kind,
        from: bucket(events.at(-1)!.payload.fromBucket),
        to: bucket(newest.payload.toBucket),
      };
    case 'deadline': {
      const daysLeft = Number(newest.payload.daysLeft);
      if (!Number.isInteger(daysLeft)) return null;
      return { kind, dueDate: addDays(newest.day, daysLeft) };
    }
    case 'messages':
    case 'mentions': {
      const authors = [
        // A description mention names its writer `actorName`.
        ...new Set(
          events
            .map((e) => str(e.payload.authorName) ?? str(e.payload.actorName))
            .filter((n) => n !== null),
        ),
      ];
      return { kind, count: events.length, authors: authors.slice(0, MAX_AUTHORS) };
    }
    case 'dueChanged':
      return { kind, dueDate: str(newest.payload.dueDate) };
    case 'overdue': {
      const dueDate = str(newest.payload.dueDate);
      return dueDate ? { kind, dueDate } : null;
    }
    case 'status': {
      if (newest.kind === 'ticket.resolved') return { kind, status: 'resolved' };
      const status = TicketStatusSchema.safeParse(newest.payload.status);
      return status.success ? { kind, status: status.data } : null;
    }
    case 'tasks':
      return {
        kind,
        count: events.reduce((sum, e) => sum + (Number(e.payload.count) || 0), 0),
      };
    default:
      return { kind };
  }
}

/**
 * "What changed since I last opened it" (2026-10-18): the viewer's unseen events of one task or
 * ticket, newest first, as one line per kind of change, ordered by each kind's newest event; at
 * most `UNSEEN_SUMMARY_LINES`, the rest counted in `more`. Only counts, names of people and
 * columns, statuses and dates; never a message's text.
 */
export function summarizeUnseen(rows: UnseenEventRow[]): UnseenSummary {
  const byKind = new Map<UnseenSummaryLine['kind'], UnseenEventRow[]>();
  for (const row of rows) {
    const kind = lineKind(row.kind);
    if (!kind) continue;
    const list = byKind.get(kind);
    if (list) list.push(row);
    else byKind.set(kind, [row]);
  }
  // A Map keeps insertion order: the first event of each kind is its newest.
  const lines = [...byKind]
    .map(([kind, events]) => buildLine(kind, events))
    .filter((line) => line !== null);
  return {
    lines: lines.slice(0, UNSEEN_SUMMARY_LINES),
    more: Math.max(0, lines.length - UNSEEN_SUMMARY_LINES),
  };
}
