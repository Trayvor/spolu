import type { Month, WorkLogEntry, WorkLogMonth, WorkLogPageDto } from '@spolu/shared';

/**
 * The work log's chronology from its pages (spec §6.1): months oldest first, each with its full
 * totals from the server, then days oldest first. A ticket and the tasks made from it are one
 * unit (2026-10-17): within a month its entries gather on the day of the ticket's own entry (or
 * of the unit's first entry there), the ticket's entries first, its tasks under them. Pure, so
 * the order and the units are unit-tested.
 */

type LogTicket = WorkLogPageDto['tickets'][number];

export type LogItem =
  | { kind: 'entry'; entry: WorkLogEntry }
  | { kind: 'unit'; ticket: LogTicket; own: WorkLogEntry[]; tasks: WorkLogEntry[] };

type LogDay = { day: string; items: LogItem[] };
export type LogMonth = { month: Month; totals: WorkLogMonth | null; days: LogDay[] };

export function chronology(pages: readonly WorkLogPageDto[]): LogMonth[] {
  // Pages come newest first, each newest first: reversed, everything is oldest first.
  const entries = pages.flatMap((p) => p.entries).reverse();
  const tickets = new Map(pages.flatMap((p) => p.tickets).map((t) => [t.id, t]));
  const totals = new Map(pages.flatMap((p) => p.months).map((m) => [m.month, m]));

  const byMonth = new Map<Month, WorkLogEntry[]>();
  for (const entry of entries) {
    const month = entry.workedOn.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(entry);
    byMonth.set(month, list);
  }

  return [...byMonth].map(([month, list]) => {
    // The anchor day of each unit in this month.
    const anchors = new Map<string, string>();
    // `list` is oldest first, so the first match is the earliest.
    for (const entry of list) {
      const unit = entry.unitTicketId;
      if (!unit || !tickets.has(unit) || anchors.has(unit)) continue;
      anchors.set(unit, list.find((e) => e.ticketId === unit)?.workedOn ?? entry.workedOn);
    }
    const days = new Map<string, LogItem[]>();
    const units = new Map<string, Extract<LogItem, { kind: 'unit' }>>();
    const place = (day: string, item: LogItem) => {
      const items = days.get(day) ?? [];
      items.push(item);
      days.set(day, items);
    };
    for (const entry of list) {
      const unit = entry.unitTicketId;
      const anchor = unit ? anchors.get(unit) : undefined;
      if (!unit || !anchor) {
        place(entry.workedOn, { kind: 'entry', entry });
        continue;
      }
      let item = units.get(unit);
      if (!item) {
        item = { kind: 'unit', ticket: tickets.get(unit)!, own: [], tasks: [] };
        units.set(unit, item);
        place(anchor, item);
      }
      (entry.ticketId === unit ? item.own : item.tasks).push(entry);
    }
    return {
      month,
      totals: totals.get(month) ?? null,
      days: [...days]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, items]) => ({ day, items })),
    };
  });
}
