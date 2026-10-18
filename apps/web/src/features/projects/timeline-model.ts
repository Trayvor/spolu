import type { TimelineEventDto } from '@spolu/shared';

/** The pure parts of the timeline (spec §7.2): merging pages, Today's place, the gaps. */

/** Neighbours further apart than this get a gap mark on the line. */
const GAP_DAYS = 60;

/** The pages' events in order, each once (a page refetched after a change may overlap another). */
export function mergeEvents(
  pages: (readonly TimelineEventDto[] | undefined)[],
): TimelineEventDto[] {
  const seen = new Set<string>();
  const events: TimelineEventDto[] = [];
  for (const page of pages) {
    for (const event of page ?? []) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
  }
  return events;
}

/**
 * Where the Today marker goes: before the first event from today on (an event of today comes
 * right after it), after the last one when every event is past.
 */
export function todayIndex(events: readonly TimelineEventDto[], today: string): number {
  const index = events.findIndex((event) => event.occursOn >= today);
  return index === -1 ? events.length : index;
}

/** Whole days from `from` to `to` (`YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** A gap of more than 60 days, in months (under two years) or years; null when shorter. */
export function gapOf(days: number): { unit: 'months' | 'years'; count: number } | null {
  if (days <= GAP_DAYS) return null;
  const months = Math.round(days / 30.44);
  if (months < 24) return { unit: 'months', count: months };
  return { unit: 'years', count: Math.round(months / 12) };
}

/** Past, today or coming, by the Bratislava day the server sent. */
export function whenOf(occursOn: string, today: string): 'past' | 'today' | 'coming' {
  if (occursOn < today) return 'past';
  return occursOn === today ? 'today' : 'coming';
}
