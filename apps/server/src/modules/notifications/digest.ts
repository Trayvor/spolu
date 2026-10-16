import { and, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { wantsEmail, type UserLanguage } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { sendEmailLater, type EmailMessage } from '../../infra/email/index.js';
import { buildEmail } from '../../infra/email/layout.js';
import { unreadForNotify } from '../chat/notify.js';
import { groups } from '../groups/schema.js';
import { getTaskTitles } from '../tasks/task-service.js';
import { getNotificationProfiles } from '../users/service.js';
import { notificationGroupOf } from './categories.js';
import type { NotificationJobDeps } from './deliver.js';
import { digestEntry, type DigestEntry } from './digest-entries.js';
import { notificationEvents } from './schema.js';
import { texts } from './texts.js';

const MAX_LINES = 5;

type EventRow = typeof notificationEvents.$inferSelect;

const payloadOf = (row: EventRow) => (row.payload ?? {}) as Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** One digest email: the subject counts all events, the body shows the newest 5. */
export function digestEmail(i: {
  to: string;
  lang: UserLanguage;
  groupName: string;
  url: string;
  button: string;
  count: number;
  lines: string[];
}): EmailMessage {
  const t = texts(i.lang);
  return buildEmail({
    to: i.to,
    subject: t.digestSubject(i.count, i.groupName),
    paragraphs: i.lines.slice(-MAX_LINES),
    button: { label: i.button, url: i.url },
  });
}

/** The entries of one user and group, one email per `url`, in first-seen order. */
export function splitByUrl(
  entries: { entry: DigestEntry; rowId: string }[],
): { url: string; button: string; lines: string[]; rowIds: string[] }[] {
  const byUrl = new Map<
    string,
    { url: string; button: string; lines: string[]; rowIds: string[] }
  >();
  for (const { entry, rowId } of entries) {
    const split = byUrl.get(entry.url) ?? {
      url: entry.url,
      button: entry.button,
      lines: [],
      rowIds: [],
    };
    split.lines.push(entry.line);
    split.rowIds.push(rowId);
    byUrl.set(entry.url, split);
  }
  return [...byUrl.values()];
}

/**
 * Emails the digests that are due: per user and group that has an unsent email-eligible event
 * whose `email_due_at` has passed (scoped to `userIds` when given). The pair's pending rows are
 * locked with `FOR UPDATE SKIP LOCKED` and stamped `emailed_at`, so concurrent workers never email
 * the same rows twice; the rows still unread (task events always count) whose notification group
 * still wants email make the email, one per entry url (`digestEntry`). Emails are queued after
 * the commit; returns how many.
 */
export async function sendDueDigests(
  deps: NotificationJobDeps,
  opts: { now?: Date; userIds?: string[] } = {},
): Promise<number> {
  if (opts.userIds && opts.userIds.length === 0) return 0;
  const now = opts.now ?? new Date();
  const digests = await deps.db.transaction((tx) => collectDigests(tx, deps, now, opts.userIds));
  let queued = 0;
  for (const { email, rowIds } of digests) {
    try {
      await sendEmailLater(deps.jobs, email);
      queued += 1;
    } catch (error) {
      // Give the rows back so the next sweep retries. A crash between the commit and the send
      // still loses the digest; that is accepted, as for a push.
      console.error('notifications: digest email could not be queued (the sweep retries)', error);
      await deps.db
        .update(notificationEvents)
        .set({ emailedAt: null })
        .where(inArray(notificationEvents.id, rowIds));
    }
  }
  return queued;
}

async function collectDigests(
  tx: Db,
  deps: NotificationJobDeps,
  now: Date,
  userIds: string[] | undefined,
): Promise<{ email: EmailMessage; rowIds: string[] }[]> {
  const due = await tx
    .selectDistinct({ userId: notificationEvents.userId, groupId: notificationEvents.groupId })
    .from(notificationEvents)
    .where(
      and(
        isNull(notificationEvents.emailedAt),
        isNotNull(notificationEvents.groupId),
        lte(notificationEvents.emailDueAt, now),
        userIds ? inArray(notificationEvents.userId, [...new Set(userIds)]) : undefined,
      ),
    );
  if (due.length === 0) return [];
  // One lock per pair, in a fixed order: a parallel run waits here, then finds the rows emailed
  // and sends nothing (no early second email for events that arrived in between).
  const keys = [...new Set(due.map((p) => `${p.userId}${p.groupId}`))].sort();
  for (const key of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
  const pairs = sql.join(
    due.map((p) => sql`(${p.userId}::text, ${p.groupId}::text)`),
    sql`, `,
  );
  // Every pending row of the pairs, also those not yet due: they join the same email.
  const rows = await tx
    .select()
    .from(notificationEvents)
    .where(
      and(
        isNull(notificationEvents.emailedAt),
        isNotNull(notificationEvents.emailDueAt),
        sql`(${notificationEvents.userId}, ${notificationEvents.groupId}) in (${pairs})`,
      ),
    )
    .orderBy(notificationEvents.createdAt, notificationEvents.id)
    .for('update', { skipLocked: true });
  if (rows.length === 0) return [];
  await tx
    .update(notificationEvents)
    .set({ emailedAt: now })
    .where(
      inArray(
        notificationEvents.id,
        rows.map((r) => r.id),
      ),
    );

  const userSet = [...new Set(rows.map((r) => r.userId))];
  const profiles = await getNotificationProfiles(tx, userSet);
  const unread = await unreadForNotify(
    tx,
    rows.flatMap((r) => {
      const messageId = str(payloadOf(r).messageId);
      return messageId ? [{ userId: r.userId, messageId }] : [];
    }),
  );
  const taskTitles = await getTaskTitles(
    tx,
    rows.flatMap((r) => str(payloadOf(r).taskId) ?? []),
  );

  const byPair = new Map<string, EventRow[]>();
  for (const r of rows) {
    const key = `${r.userId}\u0000${r.groupId}`;
    byPair.set(key, [...(byPair.get(key) ?? []), r]);
  }
  const groupNames = new Map(
    (
      await tx
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(inArray(groups.id, [...new Set(rows.map((r) => r.groupId!))]))
    ).map((g) => [g.id, g.name]),
  );
  const digests: { email: EmailMessage; rowIds: string[] }[] = [];
  for (const events of byPair.values()) {
    const first = events[0]!;
    const profile = profiles.get(first.userId);
    if (!profile || profile.disabled) continue;
    const groupName = groupNames.get(first.groupId!);
    if (groupName === undefined) continue;
    const ctx = {
      groupName,
      groupId: first.groupId!,
      publicUrl: deps.config.publicUrl,
      lang: profile.language,
      taskTitles,
    };
    const seen = new Set<string>();
    const entries: { entry: DigestEntry; rowId: string }[] = [];
    for (const row of events) {
      const p = payloadOf(row);
      // The group's channel now decides: switching it away from email before the digest is due
      // means no email for its events.
      const group = notificationGroupOf(row.kind, p);
      if (group === null || !wantsEmail(profile.channels[group])) continue;
      const messageId = str(p.messageId);
      if (messageId !== null) {
        if (!unread.has(`${row.userId}:${messageId}`) || seen.has(messageId)) continue;
        seen.add(messageId);
      }
      const entry = digestEntry({ kind: row.kind, payload: p }, ctx);
      if (entry) entries.push({ entry, rowId: row.id });
    }
    for (const split of splitByUrl(entries)) {
      digests.push({
        rowIds: split.rowIds,
        email: digestEmail({
          to: profile.email,
          lang: profile.language,
          groupName,
          url: split.url,
          button: split.button,
          count: split.lines.length,
          lines: split.lines,
        }),
      });
    }
  }
  return digests;
}
