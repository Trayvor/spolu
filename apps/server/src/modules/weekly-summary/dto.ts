import { asc, count, eq, inArray } from 'drizzle-orm';
import {
  weeklyItemCount,
  WeeklySummarySections,
  type WeeklySummaryDto,
  type WeeklySummaryListItem,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { getGroup } from '../groups/service.js';
import { eventTitlesInGroup } from '../projects/weekly-facts.js';
import { taskTitlesInGroup } from '../tasks/weekly-facts.js';
import { ticketTitlesInGroup } from '../tickets/weekly-facts.js';
import { getNotificationProfiles } from '../users/service.js';
import { currentRecipientCounts, currentRecipients } from './recipients.js';
import { weeklySummaryRecipients } from './schema.js';
import { revisionCount, type ListRow, type SummaryRow } from './service.js';

const iso = (d: string | Date | null): string | null =>
  d === null ? null : new Date(d).toISOString();

/** Frozen statuses: the recipients are the rows of `weekly_summary_recipients`. */
const frozen = (status: SummaryRow['status']) => status === 'sending' || status === 'sent';

/** A page of the list, its recipient counts in at most three queries (never per row). */
export async function toListItems(db: Db, rows: ListRow[]): Promise<WeeklySummaryListItem[]> {
  const sentIds = rows.filter((r) => frozen(r.status)).map((r) => r.id);
  const openGroups = rows.filter((r) => !frozen(r.status)).map((r) => r.group_id);
  const [sentCounts, openCounts] = await Promise.all([
    sentIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: weeklySummaryRecipients.summaryId, n: count() })
          .from(weeklySummaryRecipients)
          .where(inArray(weeklySummaryRecipients.summaryId, sentIds))
          .groupBy(weeklySummaryRecipients.summaryId),
    currentRecipientCounts(db, openGroups),
  ]);
  const sent = new Map(sentCounts.map((c) => [c.id, c.n]));
  return rows.map((r) => ({
    id: r.id,
    groupId: r.group_id,
    groupName: r.group_name,
    week: r.week,
    status: r.status,
    skipReason: r.skip_reason,
    source: r.source,
    aiFailed: r.ai_failed,
    itemCount: Number(r.item_count),
    recipientCount: frozen(r.status) ? (sent.get(r.id) ?? 0) : (openCounts.get(r.group_id) ?? 0),
    updatedAt: iso(r.updated_at)!,
    sentAt: iso(r.sent_at),
    managedByMe: r.managed_by_me,
  }));
}

/** The editor's DTO (spec §7.1): names and languages of the recipients, never their emails. */
export async function toDto(db: Db, row: SummaryRow, manages: boolean): Promise<WeeklySummaryDto> {
  const items = WeeklySummarySections.flatMap((s) => row.content[s]);
  const ids = (kind: 'task' | 'ticket' | 'event') =>
    items.flatMap((i) => (i.ref?.kind === kind ? [i.ref.id] : []));
  const [group, recipients, tasks, tickets, events, revisions, people] = await Promise.all([
    getGroup(db, row.groupId),
    frozen(row.status)
      ? db
          .select({
            name: weeklySummaryRecipients.name,
            language: weeklySummaryRecipients.language,
          })
          .from(weeklySummaryRecipients)
          .where(eq(weeklySummaryRecipients.summaryId, row.id))
          .orderBy(asc(weeklySummaryRecipients.name))
      : currentRecipients(db, row.groupId).then((list) =>
          list.map((r) => ({ name: r.name, language: r.language })),
        ),
    taskTitlesInGroup(db, row.groupId, ids('task')),
    ticketTitlesInGroup(db, row.groupId, ids('ticket')),
    eventTitlesInGroup(db, row.groupId, ids('event')),
    revisionCount(db, row.id),
    getNotificationProfiles(
      db,
      [row.updatedBy, row.sentBy].filter((id): id is string => id !== null),
    ),
  ]);
  const refs: WeeklySummaryDto['refs'] = {};
  const enc = encodeURIComponent;
  for (const item of items) {
    if (!item.ref) continue;
    const { kind, id } = item.ref;
    if (kind === 'task') {
      const title = tasks.get(id);
      if (title) refs[item.id] = { kind, title, url: `/groups/${row.groupId}/tasks/${enc(id)}` };
    } else if (kind === 'ticket') {
      const title = tickets.get(id);
      if (title) refs[item.id] = { kind, title, url: `/tickets/${enc(id)}` };
    } else {
      const event = events.get(id);
      if (event) {
        refs[item.id] = {
          kind,
          title: event.title,
          url: `/groups/${row.groupId}/overview?event=${enc(id)}`,
        };
      }
    }
  }
  const name = (id: string | null) => {
    const p = id ? people.get(id) : undefined;
    return p ? { name: p.name } : null;
  };
  const deactivated = group?.deactivatedAt != null;
  return {
    id: row.id,
    groupId: row.groupId,
    groupName: group?.name ?? '',
    week: row.week,
    status: row.status,
    skipReason: row.skipReason,
    source: row.source,
    aiFailed: row.aiFailed,
    itemCount: weeklyItemCount(row.content),
    recipientCount: recipients.length,
    updatedAt: row.updatedAt.toISOString(),
    sentAt: iso(row.sentAt),
    managedByMe: manages,
    windowStart: row.windowStart.toISOString(),
    windowEnd: row.windowEnd.toISOString(),
    language: row.language,
    content: row.content,
    version: row.version,
    canEdit: manages && row.status === 'draft',
    revisionCount: revisions,
    recipients,
    refs,
    updatedBy: name(row.updatedBy),
    sentBy: name(row.sentBy),
    groupDeactivated: deactivated,
  };
}
