import { describe, expect, it } from 'vitest';
import { logEntry, logMonth, logPage } from './test-data';
import { chronology } from './work-log-groups';

describe('chronology', () => {
  it('puts months and days oldest first across pages, each month with its totals', () => {
    const newest = logPage({
      entries: [
        logEntry({ id: 'oct2', workedOn: '2026-10-02' }),
        logEntry({ id: 'oct1b', workedOn: '2026-10-01' }),
        logEntry({ id: 'oct1a', workedOn: '2026-10-01' }),
        logEntry({ id: 'sep30', workedOn: '2026-09-30' }),
      ],
      months: [logMonth('2026-10', 180), logMonth('2026-09', 600)],
      before: 'cursor',
    });
    const older = logPage({
      entries: [logEntry({ id: 'sep1', workedOn: '2026-09-01' })],
      months: [logMonth('2026-09', 600)],
    });
    const months = chronology([newest, older]);
    expect(months.map((m) => [m.month, m.totals?.minutes])).toEqual([
      ['2026-09', 600],
      ['2026-10', 180],
    ]);
    expect(
      months.map((m) =>
        m.days.map((d) => [d.day, d.items.map((i) => i.kind === 'entry' && i.entry.id)]),
      ),
    ).toEqual([
      [
        ['2026-09-01', ['sep1']],
        ['2026-09-30', ['sep30']],
      ],
      [
        ['2026-10-01', ['oct1a', 'oct1b']],
        ['2026-10-02', ['oct2']],
      ],
    ]);
  });

  it("gathers a ticket and its tasks on the ticket entry's day, the ticket first", () => {
    const ticket = { id: 'k1', number: 123, title: 'Login broken' };
    const page = logPage({
      entries: [
        logEntry({
          id: 'own',
          source: 'ticket',
          ticketId: 'k1',
          unitTicketId: 'k1',
          workedOn: '2026-10-05',
        }),
        logEntry({ id: 'other', workedOn: '2026-10-04' }),
        logEntry({
          id: 'task2',
          source: 'task',
          taskId: 't2',
          linkedTicketId: 'k1',
          unitTicketId: 'k1',
          workedOn: '2026-10-03',
        }),
        logEntry({
          id: 'task1',
          source: 'task',
          taskId: 't1',
          linkedTicketId: 'k1',
          unitTicketId: 'k1',
          workedOn: '2026-10-02',
        }),
        // A unit without its ticket's entry in this month sits on its first entry's day.
        logEntry({
          id: 'septask',
          source: 'task',
          taskId: 't3',
          linkedTicketId: 'k1',
          unitTicketId: 'k1',
          workedOn: '2026-09-20',
        }),
      ],
      tickets: [ticket],
    });
    const [sep, oct] = chronology([page]);
    expect(sep!.days.map((d) => d.day)).toEqual(['2026-09-20']);
    expect(oct!.days.map((d) => d.day)).toEqual(['2026-10-04', '2026-10-05']);
    const unit = oct!.days[1]!.items[0]!;
    expect(unit.kind).toBe('unit');
    if (unit.kind !== 'unit') return;
    expect(unit.ticket).toEqual(ticket);
    expect(unit.own.map((e) => e.id)).toEqual(['own']);
    expect(unit.tasks.map((e) => e.id)).toEqual(['task1', 'task2']);
  });
});
