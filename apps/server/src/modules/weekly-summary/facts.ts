import type { WeeklySummaryRefKind } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { clientVisibleMessagesOf } from '../chat/weekly-facts.js';
import { upcomingEventsOf } from '../projects/weekly-facts.js';
import {
  doneTasksOf,
  dueTasksOf,
  taskTitlesInGroup,
  waitingOnClientTasksOf,
} from '../tasks/weekly-facts.js';
import { resolvedTicketsOf, ticketTitle } from '../tickets/weekly-facts.js';
import { addDays, bratislavaDay } from './week.js';

/**
 * The facts of one group's window (spec §4), read only through the owning modules' exported
 * readers. Each fact has an opaque key (`t1`, `k1`, `e1`) the AI may cite; the server maps it
 * back to its ref, so no id leaves the server.
 */

export type Fact = {
  key: string;
  ref: { kind: WeeklySummaryRefKind; id: string };
  text: string;
  /** `YYYY-MM-DD` (Bratislava) or null. */
  date: string | null;
};

export type FactMessage = { author: string; text: string; at: Date; place: string | null };

export type Facts = { done: Fact[]; waiting: Fact[]; upcoming: Fact[]; messages: FactMessage[] };

/** How far ahead "What is coming" looks, in days after today. */
export const UPCOMING_DAYS = 14;

export async function collectFacts(
  db: Db,
  groupId: string,
  window: { start: Date; end: Date },
  today: string,
): Promise<Facts> {
  const tomorrow = addDays(today, 1);
  const until = addDays(today, UPCOMING_DAYS);
  const [done, resolved, waiting, due, events, messages] = await Promise.all([
    doneTasksOf(db, groupId, window.start, window.end),
    resolvedTicketsOf(db, groupId, window.start, window.end),
    waitingOnClientTasksOf(db, groupId),
    dueTasksOf(db, groupId, tomorrow, until),
    upcomingEventsOf(db, groupId, tomorrow, until),
    clientVisibleMessagesOf(db, groupId, window.start, window.end),
  ]);
  const counters = { t: 0, k: 0, e: 0 };
  const key = (prefix: keyof typeof counters) => `${prefix}${++counters[prefix]}`;

  const doneFacts: Fact[] = [
    ...done.map((t) => ({
      key: key('t'),
      ref: { kind: 'task' as const, id: t.id },
      text: t.title,
      date: bratislavaDay(t.completedAt),
    })),
    ...resolved.map((k) => ({
      key: key('k'),
      ref: { kind: 'ticket' as const, id: k.id },
      text: ticketTitle(k.number, k.subject),
      date: bratislavaDay(k.resolvedAt),
    })),
  ];
  const waitingFacts: Fact[] = waiting.map((t) => ({
    key: key('t'),
    ref: { kind: 'task', id: t.id },
    text: t.title,
    date: t.dueDate,
  }));
  const waitingIds = new Set(waiting.map((t) => t.id));
  const upcomingFacts: Fact[] = [
    ...due
      .filter((t) => !waitingIds.has(t.id))
      .map((t) => ({
        key: key('t'),
        ref: { kind: 'task' as const, id: t.id },
        text: t.title,
        date: t.dueDate as string | null,
      })),
    ...events.map((e) => ({
      key: key('e'),
      ref: { kind: 'event' as const, id: e.id },
      text: `${e.name} (${e.projectName})`,
      date: e.occursOn as string | null,
    })),
  ].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.key.localeCompare(b.key));

  const taskIds = [...new Set(messages.flatMap((m) => (m.taskId ? [m.taskId] : [])))];
  const places = await taskTitlesInGroup(db, groupId, taskIds);
  return {
    done: doneFacts,
    waiting: waitingFacts,
    upcoming: upcomingFacts,
    messages: messages.map((m) => ({
      author: m.author,
      text: m.text,
      at: m.at,
      place: m.taskId ? (places.get(m.taskId) ?? null) : null,
    })),
  };
}

/** Anything happened or is asked: no facts and no messages means the week is skipped. */
export function hasActivity(f: Facts): boolean {
  return f.done.length + f.waiting.length + f.upcoming.length + f.messages.length > 0;
}

/** Every fact of all sections by key. */
export function factsByKey(f: Facts): Map<string, Fact> {
  return new Map([...f.done, ...f.waiting, ...f.upcoming].map((fact) => [fact.key, fact]));
}
