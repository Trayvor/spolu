import { and, count, eq, sql } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import type { UserLanguage, WeeklySummaryContent, WeeklySummaryItem } from '@spolu/shared';
import type { Config } from '../../infra/config/config.js';
import type { Db } from '../../infra/db/client.js';
import { sendEmailLater, type EmailMessage } from '../../infra/email/index.js';
import type { JobQueue } from '../../infra/jobs/jobs.js';
import { getGroup } from '../groups/service.js';
import { eventRefsInGroup } from '../projects/weekly-facts.js';
import { taskRefsInGroup } from '../tasks/weekly-facts.js';
import { ticketRefsInGroup } from '../tickets/weekly-facts.js';
import { summaryEmail } from './email.js';
import {
  NoRecipientsError,
  NotDraftError,
  RefsChangedError,
  StaleVersionError,
  SummaryGroupInactiveError,
} from './errors.js';
import { emitSummaryChanged } from './events.js';
import { freezeRecipients } from './recipients.js';
import { weeklySummaries, weeklySummaryRecipients } from './schema.js';
import { searchText } from './search-text.js';
import type { SummaryRow } from './service.js';
import { signSummaryUnsubscribeToken, summaryUnsubscribeUrls } from './token.js';
import { rangeText } from './week.js';

/** The send job's name (also in `jobs.ts`; kept here so this file does not import the jobs). */
const WS_SEND_JOB = 'weekly-summary.send';
/** Recipients emailed per run of the send job. */
export const SEND_BATCH = 20;

type SendDeps = { db: Db; config: Config; jobs: JobQueue; io: SocketIOServer | null };

const SECTIONS = ['done', 'waiting', 'upcoming'] as const;

/** Drops the items whose ref fails `keep`; null when nothing was dropped. */
function withoutRefs(
  content: WeeklySummaryContent,
  keep: (item: WeeklySummaryItem) => boolean,
): WeeklySummaryContent | null {
  let dropped = false;
  const next = { ...content };
  for (const s of SECTIONS) {
    next[s] = content[s].filter((item) => {
      const ok = keep(item);
      if (!ok) dropped = true;
      return ok;
    });
  }
  return dropped ? next : null;
}

/**
 * Send (spec §7.2): in one transaction under the row lock, check the draft and its version,
 * re-check every ref against the group (a ticket moved to another client, a deleted task or
 * event: those items are dropped, the row saved and `RefsChangedError` thrown after the commit),
 * freeze the recipients and set `sending`; after the commit one send job. Null when the summary
 * does not exist.
 */
export async function sendSummary(
  deps: SendDeps,
  actorId: string,
  id: string,
  version: number,
): Promise<{ recipients: number } | null> {
  const result = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(weeklySummaries)
      .where(eq(weeklySummaries.id, id))
      .for('update');
    if (!row) return null;
    if (row.status !== 'draft') throw new NotDraftError();
    if (row.version !== version) throw new StaleVersionError(row);
    const group = await getGroup(tx, row.groupId);
    if (!group || group.deactivatedAt) throw new SummaryGroupInactiveError();

    const ids = (kind: 'task' | 'ticket' | 'event') =>
      SECTIONS.flatMap((s) => row.content[s]).flatMap((i) =>
        i.ref?.kind === kind ? [i.ref.id] : [],
      );
    const [tasks, tickets, events] = await Promise.all([
      taskRefsInGroup(tx, row.groupId, ids('task')),
      ticketRefsInGroup(tx, row.groupId, ids('ticket')),
      eventRefsInGroup(tx, row.groupId, ids('event')),
    ]);
    const sets = { task: tasks, ticket: tickets, event: events };
    const corrected = withoutRefs(row.content, (i) => !i.ref || sets[i.ref.kind].has(i.ref.id));
    if (corrected) {
      const [saved] = await tx
        .update(weeklySummaries)
        .set({
          content: corrected,
          searchText: searchText(corrected),
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(weeklySummaries.id, id))
        .returning();
      return { kind: 'refsChanged' as const, row: saved! };
    }
    const recipients = await freezeRecipients(tx, row.id, row.groupId);
    if (recipients === 0) throw new NoRecipientsError();
    const [sending] = await tx
      .update(weeklySummaries)
      .set({ status: 'sending', sentBy: actorId, version: row.version + 1, updatedAt: new Date() })
      .where(eq(weeklySummaries.id, id))
      .returning();
    return { kind: 'sending' as const, row: sending!, recipients };
  });
  if (!result) return null;
  emitSummaryChanged(deps.io, result.row);
  if (result.kind === 'refsChanged') throw new RefsChangedError(result.row);
  await deps.jobs.send(WS_SEND_JOB, { summaryId: id });
  return { recipients: result.recipients };
}

/** The email of one recipient (or a preview / test with `test` and a dummy token). */
export function emailOf(
  config: Config,
  row: SummaryRow,
  groupName: string,
  r: { userId: string; email: string; language: UserLanguage },
  test = false,
): EmailMessage {
  const token = signSummaryUnsubscribeToken(config.appSecret, r.userId, row.groupId);
  return summaryEmail({
    to: r.email,
    lang: r.language,
    publicUrl: config.publicUrl,
    groupId: row.groupId,
    groupName,
    range: rangeText(r.language, row.windowStart, row.windowEnd),
    content: row.content,
    unsubscribe: summaryUnsubscribeUrls(config.publicUrl, token),
    test,
  });
}

/**
 * One run of the send job: up to 20 pending recipients locked (`for update skip locked`), each
 * person's email queued (the email job retries) and the row marked sent; again while rows are
 * left, then the summary is `sent`.
 */
export async function sendBatch(deps: SendDeps, summaryId: string): Promise<void> {
  const { db, config } = deps;
  const [row] = await db.select().from(weeklySummaries).where(eq(weeklySummaries.id, summaryId));
  if (!row || row.status !== 'sending') return;
  const group = await getGroup(db, row.groupId);
  const groupName = group?.name ?? '';
  await db.transaction(async (tx) => {
    const batch = await tx
      .select()
      .from(weeklySummaryRecipients)
      .where(
        and(
          eq(weeklySummaryRecipients.summaryId, summaryId),
          eq(weeklySummaryRecipients.status, 'pending'),
        ),
      )
      .limit(SEND_BATCH)
      .for('update', { skipLocked: true });
    for (const r of batch) {
      if (r.email) {
        await sendEmailLater(
          deps.jobs,
          emailOf(config, row, groupName, {
            userId: r.userId,
            email: r.email,
            language: r.language,
          }),
        );
      }
      await tx
        .update(weeklySummaryRecipients)
        .set({ status: r.email ? 'sent' : 'failed', sentAt: new Date() })
        .where(
          and(
            eq(weeklySummaryRecipients.summaryId, summaryId),
            eq(weeklySummaryRecipients.userId, r.userId),
          ),
        );
    }
  });
  const [left] = await db
    .select({ n: count() })
    .from(weeklySummaryRecipients)
    .where(
      and(
        eq(weeklySummaryRecipients.summaryId, summaryId),
        eq(weeklySummaryRecipients.status, 'pending'),
      ),
    );
  if ((left?.n ?? 0) > 0) {
    await db
      .update(weeklySummaries)
      .set({ updatedAt: new Date() })
      .where(eq(weeklySummaries.id, summaryId));
    await deps.jobs.send(WS_SEND_JOB, { summaryId });
    return;
  }
  const now = new Date();
  const [sent] = await db
    .update(weeklySummaries)
    .set({
      status: 'sent',
      sentAt: now,
      version: sql`${weeklySummaries.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(weeklySummaries.id, summaryId), eq(weeklySummaries.status, 'sending')))
    .returning();
  if (sent) emitSummaryChanged(deps.io, sent);
}
