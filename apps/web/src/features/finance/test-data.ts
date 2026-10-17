import type { WorkLogEntry, WorkLogMonth, WorkLogPageDto } from '@spolu/shared';

/** Test-only builders for the work log's entries and pages. */

let next = 0;

export function logEntry(over: Partial<WorkLogEntry> = {}): WorkLogEntry {
  next += 1;
  return {
    id: `e${next}`,
    groupId: 'g1',
    userId: 'u1',
    userName: 'Eva',
    source: 'manual',
    taskId: null,
    ticketId: null,
    linkedTicketId: null,
    unitTicketId: null,
    title: null,
    subjectDeleted: false,
    coveredByTasks: false,
    minutes: 60,
    workedOn: '2026-10-01',
    note: '',
    cost: 4000,
    ...over,
  };
}

export function logMonth(month: string, minutes: number): WorkLogMonth {
  return {
    month,
    minutes,
    taskCount: 1,
    ticketCount: 0,
    cost: minutes * 100,
    missingRateMinutes: 0,
    byAdmin: [],
  };
}

export function logPage(over: Partial<WorkLogPageDto> = {}): WorkLogPageDto {
  return { entries: [], tickets: [], months: [], summary: null, before: null, ...over };
}
