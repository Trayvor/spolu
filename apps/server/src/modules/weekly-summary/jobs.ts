import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import {
  EMPTY_WEEKLY_CONTENT,
  UserLanguages,
  weeklyItemCount,
  type UserLanguage,
  type WeeklySummaryContent,
} from '@spolu/shared';
import type { Config } from '../../infra/config/config.js';
import type { Db } from '../../infra/db/client.js';
import { sendEmailLater } from '../../infra/email/index.js';
import type { JobHandlers, JobQueue, JobSchedule, QueueSettings } from '../../infra/jobs/jobs.js';
import {
  sanitizeWeeklyDraft,
  WEEKLY_SUMMARY_TIMEOUT_MS,
  type WeeklySummaryProvider,
} from '../ai/weekly-summary.js';
import { hasActiveManagerSql, managersOfGroups } from '../groups/managers.js';
import { getGroup, getGroupLabels, namedClientExistsSql } from '../groups/service.js';
import { getNotificationProfiles } from '../users/service.js';
import { emitSummaryChanged, weeklySummaryRealtime } from './events.js';
import { collectFacts, hasActivity, type Facts } from './facts.js';
import { factsDraft } from './facts-draft.js';
import { reminderEmail } from './email.js';
import { currentRecipients } from './recipients.js';
import {
  weeklySummaries,
  weeklySummaryAdminPrefs,
  weeklySummaryRecipients,
  weeklySummaryReminders,
} from './schema.js';
import { searchText } from './search-text.js';
import { sendBatch } from './send.js';
import { bratislavaDay, isoWeek, rangeText, windowFor } from './week.js';

export const WS_PREPARE_JOB = 'weekly-summary.prepare';
export const WS_DRAFT_JOB = 'weekly-summary.draft';
export const WS_SEND_JOB = 'weekly-summary.send';
export const WS_REMIND_JOB = 'weekly-summary.remind';
export const WS_SWEEP_JOB = 'weekly-summary.sweep';
export const WS_PURGE_JOB = 'weekly-summary.purge';

const STUCK_MS = 10 * 60_000;
const PURGE_AFTER_MS = 90 * 86_400_000;

export type WeeklySummaryDeps = {
  db: Db;
  config: Config;
  jobs: JobQueue;
  /** The draft AI; null when AI is off (the factual draft). */
  ai: WeeklySummaryProvider | null;
  /** Tests shorten it; default 60 s. */
  aiTimeoutMs?: number;
  /** Default: the app's Socket.IO server attached in `app.ts`. */
  io?: SocketIOServer | null;
};

const ioOf = (deps: WeeklySummaryDeps) =>
  deps.io === undefined ? weeklySummaryRealtime() : deps.io;

// ── Prepare ──────────────────────────────────────────────────────────────────────────────────

/**
 * The groups that get a draft this week (spec §3), in one query: active client groups not
 * turned off, with an active manager and someone to send it to, and no row for the week yet;
 * each with the end of its latest row (any status) for the window. `scope` (tests) limits it.
 */
export function eligibleGroupsSql(week: string, scope?: string[]): SQL {
  const notUnsubscribed = (userId: SQL) =>
    sql`not exists (select 1 from weekly_summary_unsubscribes us
      where us.group_id = g.id and us.user_id = ${userId})`;
  return sql`select g.id,
      (select s.window_end from weekly_summaries s where s.group_id = g.id
        order by s.week desc limit 1) as previous_end
    from groups g
    where g.kind = 'client' and g.deactivated_at is null
      ${scope ? sql`and g.id in (${sql.join(scope.length ? scope.map((id) => sql`${id}`) : [sql`null`], sql`, `)})` : sql``}
      and not exists (select 1 from weekly_summary_group_settings st
        where st.group_id = g.id and not st.enabled)
      and not exists (select 1 from weekly_summaries s where s.group_id = g.id and s.week = ${week})
      and ${hasActiveManagerSql(sql`g.id`)}
      and ${namedClientExistsSql(sql`g.id`, notUnsubscribed)}`;
}

/**
 * Makes this week's `preparing` rows (never touching earlier weeks' rows) and one draft job per
 * new row. Idempotent per `(group, week)`. Returns how many rows it made.
 */
export async function prepareWeek(
  deps: WeeklySummaryDeps,
  now: Date,
  opts: { groupIds?: string[] } = {},
): Promise<number> {
  const week = isoWeek(now);
  const eligible = [
    ...(await deps.db.execute<{ id: string; previous_end: string | Date | null }>(
      eligibleGroupsSql(week, opts.groupIds),
    )),
  ];
  if (eligible.length === 0) return 0;
  const inserted = await deps.db
    .insert(weeklySummaries)
    .values(
      eligible.map((g) => {
        const window = windowFor(g.previous_end === null ? null : new Date(g.previous_end), now);
        return {
          id: randomUUID(),
          groupId: g.id,
          week,
          windowStart: window.start,
          windowEnd: window.end,
          status: 'preparing' as const,
          content: EMPTY_WEEKLY_CONTENT,
        };
      }),
    )
    .onConflictDoNothing({ target: [weeklySummaries.groupId, weeklySummaries.week] })
    .returning({ id: weeklySummaries.id });
  if (inserted.length === 0) return 0;
  const items = inserted.map((r) => ({ summaryId: r.id }));
  if (deps.jobs.sendMany) await deps.jobs.sendMany(WS_DRAFT_JOB, items);
  else for (const item of items) await deps.jobs.send(WS_DRAFT_JOB, item);
  return inserted.length;
}

// ── Draft ────────────────────────────────────────────────────────────────────────────────────

/** The recipients' most common language; a tie or nobody → `sk`. */
export function draftLanguage(languages: UserLanguage[]): UserLanguage {
  const counts = new Map<UserLanguage, number>();
  for (const l of languages) counts.set(l, (counts.get(l) ?? 0) + 1);
  let best: UserLanguage = 'sk';
  let bestCount = 0;
  let tie = false;
  for (const l of UserLanguages) {
    const n = counts.get(l) ?? 0;
    if (n > bestCount) {
      best = l;
      bestCount = n;
      tie = false;
    } else if (n === bestCount && n > 0) tie = true;
  }
  return tie || bestCount === 0 ? 'sk' : best;
}

type DraftOutcome = {
  content: WeeklySummaryContent;
  source: 'ai' | 'facts';
  aiFailed: boolean;
};

async function askAi(
  deps: WeeklySummaryDeps,
  facts: Facts,
  request: {
    groupId: string;
    groupName: string;
    language: UserLanguage;
    today: string;
    range: string;
  },
  fallback: () => WeeklySummaryContent,
): Promise<DraftOutcome> {
  const ai = deps.ai;
  if (!ai) return { content: fallback(), source: 'facts', aiFailed: false };
  const started = Date.now();
  const controller = new AbortController();
  const ms = deps.aiTimeoutMs ?? WEEKLY_SUMMARY_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, ms);
  });
  const facts3 = (list: Facts['done']) =>
    list.map((f) => ({ key: f.key, text: f.text, date: f.date }));
  try {
    const result = await Promise.race([
      ai.draft(
        {
          groupName: request.groupName,
          language: request.language,
          today: request.today,
          range: request.range,
          facts: {
            done: facts3(facts.done),
            waiting: facts3(facts.waiting),
            upcoming: facts3(facts.upcoming),
          },
          messages: facts.messages.map((m) => ({
            author: m.author,
            text: m.text,
            at: m.at.toISOString().slice(0, 16).replace('T', ' '),
            place: m.place,
          })),
        },
        controller.signal,
      ),
      timeout,
    ]);
    const content = sanitizeWeeklyDraft(result.draft, facts);
    const factCount = facts.done.length + facts.waiting.length + facts.upcoming.length;
    const outcome = weeklyItemCount(content) === 0 && factCount > 0 ? 'empty' : 'ai';
    console.info(
      `${WS_DRAFT_JOB}: group ${request.groupId} ${outcome} in ${Date.now() - started} ms` +
        (result.usage
          ? `, tokens ${result.usage.promptTokens}+${result.usage.completionTokens}`
          : ''),
    );
    if (outcome === 'empty') return { content: fallback(), source: 'facts', aiFailed: true };
    return { content, source: 'ai', aiFailed: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    console.warn(
      `${WS_DRAFT_JOB}: group ${request.groupId} AI failed (${reason}) in ${Date.now() - started} ms`,
    );
    return { content: fallback(), source: 'facts', aiFailed: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds a `preparing` row's draft (spec §3, §5): the facts; a first draft with no activity is
 * skipped without an AI call; otherwise the AI's answer or the factual draft. A row that is not
 * `preparing` any more is left alone (a retried job).
 */
export async function runDraft(deps: WeeklySummaryDeps, summaryId: string): Promise<void> {
  const { db } = deps;
  const [row] = await db.select().from(weeklySummaries).where(eq(weeklySummaries.id, summaryId));
  if (!row || row.status !== 'preparing') return;
  const group = await getGroup(db, row.groupId);
  if (!group) return;
  const now = new Date();
  const window = { start: row.windowStart, end: row.windowEnd };
  const facts = await collectFacts(db, row.groupId, window, bratislavaDay(now));
  const firstDraft = row.version === 1;
  const language = firstDraft
    ? draftLanguage((await currentRecipients(db, row.groupId)).map((r) => r.language))
    : row.language;

  let update: Partial<typeof weeklySummaries.$inferInsert>;
  if (firstDraft && !hasActivity(facts)) {
    update = {
      status: 'skipped',
      skipReason: 'no_activity',
      source: 'facts',
      content: EMPTY_WEEKLY_CONTENT,
      searchText: '',
    };
  } else {
    const range = rangeText(language, window.start, window.end);
    const outcome = await askAi(
      deps,
      facts,
      { groupId: row.groupId, groupName: group.name, language, today: bratislavaDay(now), range },
      () => factsDraft(facts, language, range),
    );
    update = {
      status: 'draft',
      source: outcome.source,
      aiFailed: outcome.aiFailed,
      content: outcome.content,
      searchText: searchText(outcome.content),
    };
  }
  const [stored] = await db
    .update(weeklySummaries)
    .set({ ...update, language, version: row.version + 1, updatedAt: new Date() })
    .where(and(eq(weeklySummaries.id, row.id), eq(weeklySummaries.status, 'preparing')))
    .returning();
  if (stored) emitSummaryChanged(ioOf(deps), stored);
}

// ── Sweep, reminder, purge ───────────────────────────────────────────────────────────────────

/**
 * Every five minutes: a summary stuck in `preparing` or `sending` for over 10 minutes (a lost
 * job, a crash) gets its job again; the row's `updated_at` moves on so it is not re-sent at
 * once. The draft job skips a row that is not preparing; a send batch locks its rows.
 */
export async function sweepStuck(deps: WeeklySummaryDeps, now: Date): Promise<number> {
  const rows = await deps.db
    .update(weeklySummaries)
    .set({ updatedAt: now })
    .where(
      and(
        inArray(weeklySummaries.status, ['preparing', 'sending']),
        lt(weeklySummaries.updatedAt, new Date(now.getTime() - STUCK_MS)),
      ),
    )
    .returning({ id: weeklySummaries.id, status: weeklySummaries.status });
  for (const r of rows) {
    await deps.jobs.send(r.status === 'preparing' ? WS_DRAFT_JOB : WS_SEND_JOB, {
      summaryId: r.id,
    });
  }
  return rows.length;
}

/**
 * Friday 09:00: one email per manager who wants reminders and has drafts of this week in their
 * groups, at most once a week (`weekly_summary_reminders`). Returns how many were sent.
 */
export async function remindManagers(
  deps: WeeklySummaryDeps,
  now: Date,
  opts: { groupIds?: string[] } = {},
): Promise<number> {
  const { db, config } = deps;
  const week = isoWeek(now);
  const drafts = await db
    .select({ groupId: weeklySummaries.groupId })
    .from(weeklySummaries)
    .where(
      and(
        eq(weeklySummaries.week, week),
        eq(weeklySummaries.status, 'draft'),
        opts.groupIds ? inArray(weeklySummaries.groupId, opts.groupIds) : undefined,
      ),
    );
  if (drafts.length === 0) return 0;
  const groupIds = drafts.map((d) => d.groupId);
  const pairs = await managersOfGroups(db, groupIds);
  const byManager = new Map<string, string[]>();
  for (const p of pairs) byManager.set(p.userId, [...(byManager.get(p.userId) ?? []), p.groupId]);
  if (byManager.size === 0) return 0;
  const managerIds = [...byManager.keys()];
  const off = await db
    .select({ userId: weeklySummaryAdminPrefs.userId })
    .from(weeklySummaryAdminPrefs)
    .where(
      and(
        inArray(weeklySummaryAdminPrefs.userId, managerIds),
        eq(weeklySummaryAdminPrefs.remind, false),
      ),
    );
  const wanted = managerIds.filter((id) => !off.some((o) => o.userId === id));
  if (wanted.length === 0) return 0;
  // Claim the week's reminder first: a second run sends nothing.
  const claimed = await db
    .insert(weeklySummaryReminders)
    .values(wanted.map((userId) => ({ userId, week })))
    .onConflictDoNothing()
    .returning({ userId: weeklySummaryReminders.userId });
  if (claimed.length === 0) return 0;
  const [profiles, names] = await Promise.all([
    getNotificationProfiles(
      db,
      claimed.map((c) => c.userId),
    ),
    groupNames(db, groupIds),
  ]);
  let sent = 0;
  for (const { userId } of claimed) {
    const profile = profiles.get(userId);
    if (!profile || profile.disabled) continue;
    const groups = (byManager.get(userId) ?? [])
      .map((id) => names.get(id) ?? '')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    await sendEmailLater(
      deps.jobs,
      reminderEmail({
        to: profile.email,
        lang: profile.language,
        publicUrl: config.publicUrl,
        groups,
      }),
    );
    sent++;
  }
  return sent;
}

async function groupNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const labels = await getGroupLabels(db, [...new Set(ids)]);
  return new Map([...labels].map(([id, label]) => [id, label.name]));
}

/**
 * Daily: blanks the email address of recipient rows sent over 90 days ago. Only an update: the
 * row (person, name, language, `sent_at`) stays, and no summary or revision is ever deleted.
 */
export async function purgeRecipientEmails(db: Db, now: Date): Promise<number> {
  const rows = await db
    .update(weeklySummaryRecipients)
    .set({ email: null })
    .where(
      and(
        isNotNull(weeklySummaryRecipients.email),
        lt(weeklySummaryRecipients.sentAt, new Date(now.getTime() - PURGE_AFTER_MS)),
      ),
    )
    .returning({ userId: weeklySummaryRecipients.userId });
  return rows.length;
}

// ── Wiring ───────────────────────────────────────────────────────────────────────────────────

export function weeklySummaryJobHandlers(deps: WeeklySummaryDeps): JobHandlers {
  const id = (data: object) => (data as { summaryId: string }).summaryId;
  return {
    [WS_PREPARE_JOB]: async () => {
      const n = await prepareWeek(deps, new Date());
      if (n > 0) console.info(`${WS_PREPARE_JOB}: ${n} drafts to prepare`);
    },
    [WS_DRAFT_JOB]: async (data) => runDraft(deps, id(data)),
    [WS_SEND_JOB]: async (data) => sendBatch({ ...deps, io: ioOf(deps) }, id(data)),
    [WS_REMIND_JOB]: async () => void (await remindManagers(deps, new Date())),
    [WS_SWEEP_JOB]: async () => void (await sweepStuck(deps, new Date())),
    [WS_PURGE_JOB]: async () => void (await purgeRecipientEmails(deps.db, new Date())),
  };
}

/** Spec §3, Bratislava time. */
export const weeklySummarySchedules: JobSchedule[] = [
  { name: WS_PREPARE_JOB, cron: '0 7 * * 5', tz: 'Europe/Bratislava' },
  { name: WS_REMIND_JOB, cron: '0 9 * * 5', tz: 'Europe/Bratislava' },
  { name: WS_SWEEP_JOB, cron: '*/5 * * * *', tz: 'Europe/Bratislava' },
  { name: WS_PURGE_JOB, cron: '10 4 * * *', tz: 'Europe/Bratislava' },
];

/** At most two AI drafts at once; one send batch at a time per process. */
export const weeklySummaryQueues: Record<string, QueueSettings> = {
  [WS_DRAFT_JOB]: { localConcurrency: 2 },
  [WS_SEND_JOB]: { policy: 'standard' },
};
