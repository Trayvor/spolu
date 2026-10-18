import { and, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { wantsEmail, type UserLanguage } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { EMAIL_JOB, sendEmailLater, type EmailMessage } from '../../infra/email/index.js';
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

/** Lines shown per section (the newest); the subject counts them all. */
const MAX_LINES = 5;
/** Sections shown per email; the rest is one "and N more" line. */
const MAX_SECTIONS = 10;
/** A one-change subject (the change's own line) is cut to this many characters. */
const SUBJECT_MAX = 120;

type EventRow = typeof notificationEvents.$inferSelect;

const payloadOf = (row: EventRow) => (row.payload ?? {}) as Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * One place of a digest email: a ticket, a group's chat, a meeting, a finance item. `messages`:
 * every line is a chat message (the subject then counts messages, not changes).
 */
export type DigestSection = {
  topic: string;
  url: string;
  button: string;
  lines: string[];
  messages: boolean;
};

function cut(line: string): string {
  const chars = Array.from(line);
  return chars.length > SUBJECT_MAX ? `${chars.slice(0, SUBJECT_MAX - 1).join('')}…` : line;
}

/**
 * The subject says what the email holds (N4 of the 2026-10-18 UX review): the messages of one
 * place ("3 new messages – Firma"), one change by its own line ("Reminder: Call the bank, …"),
 * several changes of one place ("Ticket #12: 2 updates"), or several places ("5 updates:
 * Ticket #12, Firma and 3 more").
 */
function digestSubject(lang: UserLanguage, sections: DigestSection[]): string {
  const t = texts(lang);
  if (sections.length === 1) {
    const s = sections[0]!;
    if (s.messages) return t.digestSubject(s.lines.length, s.topic);
    if (s.lines.length === 1) return cut(s.lines[0]!);
    return t.digestUpdates(s.lines.length, s.topic);
  }
  const total = sections.reduce((sum, s) => sum + s.lines.length, 0);
  return t.digestMany(
    total,
    sections.slice(0, 2).map((s) => s.topic),
    sections.length - 2,
  );
}

/**
 * One digest email of one person and window (2026-10-18: one email, not one per group or ticket).
 * One place: its newest 5 lines and its button. Several: a section each (heading, newest 5 lines,
 * button) in first-seen order, at most 10, then "And N more in Help."
 */
export function digestEmail(i: {
  to: string;
  lang: UserLanguage;
  /** The app's origin, for the logo. */
  publicUrl: string;
  sections: DigestSection[];
}): EmailMessage {
  const subject = digestSubject(i.lang, i.sections);
  const base = { to: i.to, lang: i.lang, publicUrl: i.publicUrl, subject };
  if (i.sections.length === 1) {
    const s = i.sections[0]!;
    return buildEmail({
      ...base,
      paragraphs: s.lines.slice(-MAX_LINES),
      button: { label: s.button, url: s.url },
    });
  }
  const shown = i.sections.slice(0, MAX_SECTIONS);
  const hidden = i.sections.length - shown.length;
  return buildEmail({
    ...base,
    paragraphs: [],
    sections: [
      ...shown.map((s) => ({
        heading: s.topic,
        paragraphs: s.lines.slice(-MAX_LINES),
        button: { label: s.button, url: s.url },
      })),
      ...(hidden > 0 ? [{ paragraphs: [texts(i.lang).digestMore(hidden)] }] : []),
    ],
  });
}

type DigestSplit = DigestSection & { rowIds: string[] };

/**
 * The entries of one person's email, one section per `url`, in first-seen order. `message`
 * marks an entry of a chat message.
 */
export function splitByUrl(
  entries: { entry: DigestEntry; rowId: string; message?: boolean }[],
): DigestSplit[] {
  const byUrl = new Map<string, DigestSplit>();
  for (const { entry, rowId, message } of entries) {
    const split = byUrl.get(entry.url) ?? {
      url: entry.url,
      button: entry.button,
      topic: entry.topic,
      lines: [],
      messages: true,
      rowIds: [],
    };
    split.lines.push(entry.line);
    split.rowIds.push(rowId);
    split.messages &&= message === true;
    byUrl.set(entry.url, split);
  }
  return [...byUrl.values()];
}

/**
 * Emails the digests that are due: one per user who has an unsent email-eligible event whose
 * `email_due_at` has passed (scoped to `userIds` when given; 2026-10-18: one email per person,
 * no longer one per group and ticket). The person's pending rows, of every group, are locked
 * with `FOR UPDATE SKIP LOCKED` and stamped `emailed_at`, so concurrent workers never email the
 * same rows twice; the rows still unread (task events always count) whose notification group
 * still wants email make the email, one section per entry url (`digestEntry`). Emails are queued
 * after the commit; returns how many.
 *
 * 2026-10-18: one run takes at most `maxPairs` (200) users, so a backlog after an outage is one
 * bounded transaction per sweep, not every pending row at once; the next sweep takes the rest.
 */
export async function sendDueDigests(
  deps: NotificationJobDeps,
  opts: { now?: Date; userIds?: string[]; maxPairs?: number } = {},
): Promise<number> {
  if (opts.userIds && opts.userIds.length === 0) return 0;
  const now = opts.now ?? new Date();
  const maxPairs = opts.maxPairs ?? DIGEST_PAIRS_PER_RUN;
  const digests = await deps.db.transaction((tx) =>
    collectDigests(tx, deps, now, opts.userIds, maxPairs),
  );
  if (digests.length === 0) return 0;
  if (deps.jobs.sendMany) {
    try {
      await deps.jobs.sendMany(
        EMAIL_JOB,
        digests.map((d) => d.email),
      );
      return digests.length;
    } catch (error) {
      console.error('notifications: digest emails could not be queued (the sweep retries)', error);
      await deps.db
        .update(notificationEvents)
        .set({ emailedAt: null })
        .where(
          inArray(
            notificationEvents.id,
            digests.flatMap((d) => d.rowIds),
          ),
        );
      return 0;
    }
  }
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

/** The most user and group pairs one digest run emails (2026-10-18). */
const DIGEST_PAIRS_PER_RUN = 200;

async function collectDigests(
  tx: Db,
  deps: NotificationJobDeps,
  now: Date,
  userIds: string[] | undefined,
  maxPairs: number,
): Promise<{ email: EmailMessage; rowIds: string[] }[]> {
  const due = await tx
    .selectDistinct({ userId: notificationEvents.userId })
    .from(notificationEvents)
    .where(
      and(
        isNull(notificationEvents.emailedAt),
        lte(notificationEvents.emailDueAt, now),
        userIds ? inArray(notificationEvents.userId, [...new Set(userIds)]) : undefined,
      ),
    )
    .limit(maxPairs);
  if (due.length === 0) return [];
  // One lock per person (2026-10-18: one email per person and window, not per group), in a fixed
  // order: a parallel run waits here, then finds the rows emailed and sends nothing (no early
  // second email for events that arrived in between). All the locks are one statement (Phase 27
  // S7); `with ordinality` keeps them taken in the sorted order.
  const keys = due.map((p) => p.userId).sort();
  const list = sql.join(
    keys.map((k) => sql`${k}::text`),
    sql`, `,
  );
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtext(k.key))
    from unnest(array[${list}]) with ordinality as k(key, n)
    order by k.n
  `);
  // Every pending row of these people, also those not yet due: they join the same email.
  const rows = await tx
    .select()
    .from(notificationEvents)
    .where(
      and(
        isNull(notificationEvents.emailedAt),
        isNotNull(notificationEvents.emailDueAt),
        inArray(notificationEvents.userId, keys),
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

  const byUser = new Map<string, EventRow[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  const groupNames = new Map(
    (
      await tx
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(inArray(groups.id, [...new Set(rows.flatMap((r) => r.groupId ?? []))]))
    ).map((g) => [g.id, g.name]),
  );
  const digests: { email: EmailMessage; rowIds: string[] }[] = [];
  for (const [userId, events] of byUser) {
    const profile = profiles.get(userId);
    if (!profile || profile.disabled) continue;
    const seen = new Set<string>();
    const entries: { entry: DigestEntry; rowId: string; message: boolean }[] = [];
    for (const row of events) {
      const groupId = row.groupId;
      const groupName = groupId === null ? null : groupNames.get(groupId);
      // A group deleted meanwhile: its events go with it.
      if (groupName === undefined) continue;
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
      const ctx = {
        groupName,
        groupId,
        publicUrl: deps.config.publicUrl,
        lang: profile.language,
        taskTitles,
      };
      const entry = digestEntry({ kind: row.kind, payload: p }, ctx);
      if (entry) entries.push({ entry, rowId: row.id, message: messageId !== null });
    }
    const sections = splitByUrl(entries);
    if (sections.length === 0) continue;
    digests.push({
      rowIds: sections.flatMap((s) => s.rowIds),
      email: digestEmail({
        to: profile.email,
        lang: profile.language,
        publicUrl: deps.config.publicUrl,
        sections,
      }),
    });
  }
  return digests;
}
