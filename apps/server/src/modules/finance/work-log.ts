import { sql, type SQL } from 'drizzle-orm';
import {
  WORK_LOG_PAGE_SIZE,
  type Month,
  type TimeEntrySource,
  type WorkLogEntry,
  type WorkLogMonth,
  type WorkLogPageDto,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { getGroupLabels } from '../groups/service.js';
import { getTaskTitles } from '../tasks/task-service.js';
import { getTicketRefs } from '../tickets/refs.js';
import { getUserNames } from '../users/service.js';
import {
  adminTime,
  byMinutes,
  costSql,
  countedEntriesSql,
  dayBounds,
  timeTotals,
  type TotalsRow,
} from './aggregates.js';
import { financeTimeEntries } from './schema.js';
import { monthAfter, monthStart, scopeSql, type FinanceScope, type MonthRange } from './scope.js';

/**
 * The work log (Phase 32, spec §6.1): a page of up to 200 entries, newest first (the card shows
 * them oldest at the top), with the full totals of every month the page touches and, on the
 * first page, the period's summary. No N+1: one entries query, one month-totals query (plus the
 * summary's on the first page), one batch of task titles, one of tickets, one of names.
 *
 * Requested entries ("waiting for time") are on the page so a finance admin sees what is
 * missing, but never in a total. A ticket and the tasks made from it are one unit: each entry
 * carries `unitTicketId`, and the page lists the units' tickets once (`tickets`). Every branch
 * filters by `scopeSql`, so a client's page never holds an entry without a client (decision 24);
 * only the `all` scope (part D) does.
 */

const e = financeTimeEntries;

/** The `before` cursor is malformed (400 `invalid_filter`). */
export class WorkLogCursorError extends Error {
  constructor() {
    super('Bad work log cursor');
    this.name = 'WorkLogCursorError';
  }
}

type Cursor = { day: string; id: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.day, cursor.id])).toString('base64url');
}

export function decodeCursor(text: string): Cursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value[0]) &&
      typeof value[1] === 'string' &&
      value[1].length > 0 &&
      value[1].length <= 100
    ) {
      return { day: value[0], id: value[1] };
    }
  } catch {
    // falls through
  }
  throw new WorkLogCursorError();
}

type EntryRow = {
  id: string;
  group_id: string | null;
  user_id: string;
  source: TimeEntrySource;
  task_id: string | null;
  ticket_id: string | null;
  linked_ticket_id: string | null;
  title: string | null;
  covered_by_tasks: boolean;
  minutes: number | null;
  worked_on: string;
  note: string;
  cost: string | number | null;
};

/**
 * The entries of one page: the counted ones (`finance_time_entries_group_day_idx`, or the
 * day-first index for many clients) and the requested ones (`…_open_requests_idx`, a few
 * thousand rows over every client), merged newest first. One more row than the page tells
 * whether an older page exists.
 */
export function workLogEntriesSql(
  scope: FinanceScope,
  range: MonthRange | null,
  before: Cursor | null,
  limit: number = WORK_LOG_PAGE_SIZE + 1,
): SQL {
  const bounds = range
    ? sql` and ${e.workedOn} >= ${monthStart(range.from)} and ${e.workedOn} < ${monthAfter(range.to)}`
    : sql``;
  const keyset = before
    ? sql` and (${e.workedOn}, ${e.id}) < (${before.day}::date, ${before.id})`
    : sql``;
  const columns = (
    cost: SQL,
  ) => sql`${e.id} as id, ${e.groupId} as group_id, ${e.userId} as user_id,
    ${e.source} as source, ${e.taskId} as task_id, ${e.ticketId} as ticket_id,
    ${e.linkedTicketId} as linked_ticket_id, ${e.title} as title,
    ${e.coveredByTasks} as covered_by_tasks, ${e.minutes} as minutes,
    ${e.workedOn}::text as worked_on, ${e.note} as note,
    ${cost} as cost`;
  return sql`
    select * from (
      (select ${columns(sql`round(${e.minutes}::bigint * rate.rate_minor / 60.0)::bigint`)}
        from ${e} ${costSql('finance_time_entries')}
        where ${e.minutes} is not null and ${e.workedOn} is not null
          and ${scopeSql(e.groupId, scope)}${bounds}${keyset}
        order by ${e.workedOn} desc, ${e.id} desc
        limit ${limit})
      union all
      (select ${columns(sql`null::bigint`)} from ${e}
        where ${e.minutes} is null and ${e.workedOn} is not null
          and ${scopeSql(e.groupId, scope)}${bounds}${keyset}
        order by ${e.workedOn} desc, ${e.id} desc
        limit ${limit})
    ) page
    order by worked_on desc, id desc
    limit ${limit}
  `;
}

/** How many clients a month header of the system-wide work log names. */
export const TOP_CLIENTS = 3;

/**
 * The system-wide work log's month headers (D): per month of the page, the clients with the most
 * minutes (the time without a client, `group_id` null, is one of them on the `all` scope). One
 * grouped read of the same index range as the month totals.
 */
export function topClientsSql(scope: FinanceScope, range: MonthRange): SQL {
  const month = sql`to_char(${e.workedOn}, 'YYYY-MM')`;
  return sql`
    select month, group_id, minutes from (
      select ${month} as month, ${e.groupId} as group_id, sum(${e.minutes})::int as minutes,
        row_number() over (partition by ${month}
          order by sum(${e.minutes}) desc, ${e.groupId} nulls last) as n
      from ${e}
      where ${countedEntriesSql(scope, dayBounds(range))}
      group by 1, 2
    ) ranked
    where n <= ${TOP_CLIENTS} and minutes > 0
    order by month, n`;
}

function monthOf(row: TotalsRow, rows: TotalsRow[], names: Map<string, string>): WorkLogMonth {
  return {
    month: row.month!,
    minutes: row.minutes,
    taskCount: row.taskCount,
    ticketCount: row.ticketCount,
    cost: row.cost,
    missingRateMinutes: row.missingRateMinutes,
    byAdmin: rows
      .filter((r) => r.set === 'adminMonth' && r.month === row.month)
      .map((r) => adminTime(r, names))
      .sort(byMinutes),
  };
}

/**
 * `GET /api/groups/:id/finance/work-log`: `range` null is all time; `before` the cursor of the
 * older page (null: the newest page, which also carries the summary). D calls it with a `groups`
 * or `all` scope.
 */
export async function workLogPage(
  db: Db,
  scope: FinanceScope,
  range: MonthRange | null,
  before: string | null,
): Promise<WorkLogPageDto> {
  const cursor = before === null ? null : decodeCursor(before);
  const fetched = [...(await db.execute<EntryRow>(workLogEntriesSql(scope, range, cursor)))];
  const rows = fetched.slice(0, WORK_LOG_PAGE_SIZE);
  const last = rows.at(-1);
  const next =
    fetched.length > WORK_LOG_PAGE_SIZE && last
      ? encodeCursor({ day: last.worked_on, id: last.id })
      : null;

  // The full totals of every month the page touches: from the oldest entry's month to the newest's.
  // The system-wide log (D) names each entry's client and each month's top clients.
  const manyClients = scope.kind !== 'group';
  let monthRows: TotalsRow[] = [];
  let topRows: { month: Month; group_id: string | null; minutes: number }[] = [];
  if (rows.length > 0) {
    const newest = rows[0]!.worked_on.slice(0, 7) as Month;
    const oldest = rows.at(-1)!.worked_on.slice(0, 7) as Month;
    const pageMonths = { from: oldest, to: newest };
    monthRows = await timeTotals(db, countedEntriesSql(scope, dayBounds(pageMonths)), [
      'adminMonth',
      'month',
    ]);
    if (manyClients) {
      topRows = [
        ...(await db.execute<{ month: Month; group_id: string | null; minutes: number }>(
          topClientsSql(scope, pageMonths),
        )),
      ];
    }
  }
  const summaryRows =
    cursor === null
      ? await timeTotals(db, countedEntriesSql(scope, range ? dayBounds(range) : null), [
          'admin',
          'total',
        ])
      : null;

  const ticketIds = rows.flatMap((r) =>
    [r.ticket_id, r.linked_ticket_id].filter((id) => id !== null),
  );
  const [taskTitles, ticketRefs, names, labels] = await Promise.all([
    getTaskTitles(
      db,
      rows.flatMap((r) => (r.task_id ? [r.task_id] : [])),
    ),
    getTicketRefs(db, ticketIds),
    getUserNames(db, [
      ...rows.map((r) => r.user_id),
      ...monthRows.flatMap((r) => (r.userId ? [r.userId] : [])),
      ...(summaryRows ?? []).flatMap((r) => (r.userId ? [r.userId] : [])),
    ]),
    manyClients
      ? getGroupLabels(db, [
          ...rows.flatMap((r) => (r.group_id ? [r.group_id] : [])),
          ...topRows.flatMap((r) => (r.group_id ? [r.group_id] : [])),
        ])
      : null,
  ]);

  const entries: WorkLogEntry[] = rows.map((r) => {
    const unitTicketId = r.ticket_id ?? r.linked_ticket_id;
    let title: string | null = r.title;
    let subjectDeleted = false;
    if (r.source === 'task') {
      title = (r.task_id && taskTitles.get(r.task_id)) || r.title;
      subjectDeleted = r.task_id === null || !taskTitles.has(r.task_id);
    } else if (r.source === 'ticket') {
      title = (r.ticket_id && ticketRefs.get(r.ticket_id)?.subject) || r.title;
      subjectDeleted = r.ticket_id === null || !ticketRefs.has(r.ticket_id);
    }
    return {
      id: r.id,
      groupId: r.group_id,
      ...(labels ? { groupName: r.group_id ? (labels.get(r.group_id)?.name ?? '') : null } : {}),
      userId: r.user_id,
      userName: names.get(r.user_id) ?? '',
      source: r.source,
      taskId: r.task_id,
      ticketId: r.ticket_id,
      linkedTicketId: r.linked_ticket_id,
      unitTicketId: unitTicketId !== null && ticketRefs.has(unitTicketId) ? unitTicketId : null,
      title,
      subjectDeleted,
      coveredByTasks: r.covered_by_tasks,
      minutes: r.minutes,
      workedOn: r.worked_on,
      note: r.note,
      cost: r.cost === null ? null : Number(r.cost),
    };
  });

  const storedTitle = new Map(
    rows.flatMap((r) => (r.ticket_id && r.title ? [[r.ticket_id, r.title] as const] : [])),
  );
  const tickets = [...ticketRefs].map(([id, ref]) => ({
    id,
    number: ref.number,
    title: ref.subject ?? storedTitle.get(id) ?? '',
  }));

  const months = monthRows
    .filter((r) => r.set === 'month')
    .sort((a, b) => b.month!.localeCompare(a.month!))
    .map((r) => {
      const month = monthOf(r, monthRows, names);
      if (!labels) return month;
      return {
        ...month,
        topClients: topRows
          .filter((top) => top.month === r.month)
          .map((top) => ({
            groupId: top.group_id,
            name: top.group_id ? (labels.get(top.group_id)?.name ?? '') : '',
            minutes: top.minutes,
          })),
      };
    });

  let summary: WorkLogPageDto['summary'] = null;
  if (summaryRows) {
    const total = summaryRows.find((r) => r.set === 'total');
    summary = {
      minutes: total?.minutes ?? 0,
      taskCount: total?.taskCount ?? 0,
      ticketCount: total?.ticketCount ?? 0,
      cost: total ? total.cost : null,
      missingRateMinutes: total?.missingRateMinutes ?? 0,
      byAdmin: summaryRows
        .filter((r) => r.set === 'admin')
        .map((r) => adminTime(r, names))
        .sort(byMinutes),
    };
  }

  return { entries, tickets, months, summary, before: next };
}
