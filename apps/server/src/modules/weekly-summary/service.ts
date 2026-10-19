import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import {
  WEEKLY_SUMMARY_LIMITS,
  WeeklySummaryContentSchema,
  type UserLanguage,
  type WeeklySummaryContent,
  type WeeklySummaryListQuery,
  type WeeklySummaryRevision,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { AuditActor } from '../audit/actor.js';
import { managedGroupIds } from '../groups/managers.js';
import { user } from '../users/schema.js';
import { recordSettingChanged } from './audit.js';
import { NotDraftError, StaleVersionError } from './errors.js';
import {
  weeklySummaries,
  weeklySummaryAdminPrefs,
  weeklySummaryGroupSettings,
  weeklySummaryRevisions,
  weeklySummaryUnsubscribes,
} from './schema.js';
import { searchText } from './search-text.js';

/**
 * The rows of the weekly summary module (spec 2026-10-19 §6, §7). No function here deletes or
 * expires a summary or a revision: a regeneration or a restore stores the replaced content as a
 * revision first, in the same transaction (owner decision: every report is kept).
 */

export type SummaryRow = typeof weeklySummaries.$inferSelect;

/** Malformed ids are simply not found. */
export async function getSummary(db: Db, id: string): Promise<SummaryRow | null> {
  if (id.length > 100) return null;
  const [row] = await db.select().from(weeklySummaries).where(eq(weeklySummaries.id, id));
  return row ?? null;
}

/** Content writes go through here: validated, `search_text` rewritten. */
function contentFields(content: WeeklySummaryContent): {
  content: WeeklySummaryContent;
  searchText: string;
} {
  const parsed = WeeklySummaryContentSchema.parse(content);
  return { content: parsed, searchText: searchText(parsed) };
}

/**
 * Locks the row, checks it is a draft of `version`; null when it does not exist. The callers'
 * one-transaction writes start here.
 */
async function lockDraft(tx: Db, id: string, version: number): Promise<SummaryRow | null> {
  const [row] = await tx
    .select()
    .from(weeklySummaries)
    .where(eq(weeklySummaries.id, id))
    .for('update');
  if (!row) return null;
  if (row.status !== 'draft') throw new NotDraftError();
  if (row.version !== version) throw new StaleVersionError(row);
  return row;
}

/** The manager's edit (PATCH). Null when the summary does not exist. */
export async function updateDraft(
  db: Db,
  id: string,
  version: number,
  content: WeeklySummaryContent,
  language: UserLanguage | undefined,
  actorId: string,
): Promise<SummaryRow | null> {
  return db.transaction(async (tx) => {
    const row = await lockDraft(tx, id, version);
    if (!row) return null;
    const [updated] = await tx
      .update(weeklySummaries)
      .set({
        ...contentFields(content),
        ...(language ? { language } : {}),
        version: row.version + 1,
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(eq(weeklySummaries.id, id))
      .returning();
    return updated!;
  });
}

/** "Tento týždeň neposielať": final, kept in the archive as not sent. */
export async function skipDraft(
  db: Db,
  id: string,
  version: number,
  actorId: string,
): Promise<SummaryRow | null> {
  return db.transaction(async (tx) => {
    const row = await lockDraft(tx, id, version);
    if (!row) return null;
    const [updated] = await tx
      .update(weeklySummaries)
      .set({
        status: 'skipped',
        skipReason: 'manager',
        version: row.version + 1,
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(eq(weeklySummaries.id, id))
      .returning();
    return updated!;
  });
}

async function storeRevision(tx: Db, row: SummaryRow, actorId: string): Promise<void> {
  await tx.insert(weeklySummaryRevisions).values({
    id: randomUUID(),
    summaryId: row.id,
    version: row.version,
    content: row.content,
    language: row.language,
    source: row.source ?? 'facts',
    createdBy: actorId,
  });
}

/**
 * Regenerate: the current content becomes a revision, the row goes back to `preparing` (the
 * caller then sends a draft job), optionally in another language.
 */
export async function markRegenerating(
  db: Db,
  id: string,
  version: number,
  language: UserLanguage | undefined,
  actorId: string,
): Promise<SummaryRow | null> {
  return db.transaction(async (tx) => {
    const row = await lockDraft(tx, id, version);
    if (!row) return null;
    await storeRevision(tx, row, actorId);
    const [updated] = await tx
      .update(weeklySummaries)
      .set({
        status: 'preparing',
        ...(language ? { language } : {}),
        version: row.version + 1,
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(eq(weeklySummaries.id, id))
      .returning();
    return updated!;
  });
}

/**
 * Restore: the current content becomes a revision too, then the revision's content, language
 * and source are the draft's. Null when the summary or that revision of it does not exist.
 */
export async function restoreRevision(
  db: Db,
  id: string,
  revisionId: string,
  version: number,
  actorId: string,
): Promise<SummaryRow | null> {
  return db.transaction(async (tx) => {
    const row = await lockDraft(tx, id, version);
    if (!row) return null;
    const [revision] = await tx
      .select()
      .from(weeklySummaryRevisions)
      .where(
        and(eq(weeklySummaryRevisions.id, revisionId), eq(weeklySummaryRevisions.summaryId, id)),
      );
    if (!revision) return null;
    await storeRevision(tx, row, actorId);
    const [updated] = await tx
      .update(weeklySummaries)
      .set({
        ...contentFields(revision.content),
        language: revision.language,
        source: revision.source,
        aiFailed: false,
        version: row.version + 1,
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(eq(weeklySummaries.id, id))
      .returning();
    return updated!;
  });
}

/** The summary's revisions, newest first, at most 20, with their authors' names. */
export async function listRevisions(db: Db, id: string): Promise<WeeklySummaryRevision[]> {
  const rows = await db
    .select({
      id: weeklySummaryRevisions.id,
      version: weeklySummaryRevisions.version,
      language: weeklySummaryRevisions.language,
      source: weeklySummaryRevisions.source,
      content: weeklySummaryRevisions.content,
      createdAt: weeklySummaryRevisions.createdAt,
      createdByName: user.name,
    })
    .from(weeklySummaryRevisions)
    .leftJoin(user, eq(user.id, weeklySummaryRevisions.createdBy))
    .where(eq(weeklySummaryRevisions.summaryId, id))
    .orderBy(desc(weeklySummaryRevisions.createdAt), desc(weeklySummaryRevisions.id))
    .limit(WEEKLY_SUMMARY_LIMITS.revisions);
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    language: r.language,
    source: r.source,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdByName === null ? null : { name: r.createdByName },
  }));
}

export async function revisionCount(db: Db, id: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(weeklySummaryRevisions)
    .where(eq(weeklySummaryRevisions.summaryId, id));
  return row?.n ?? 0;
}

// ── The list ─────────────────────────────────────────────────────────────────────────────────

export type ListRow = {
  id: string;
  group_id: string;
  group_name: string;
  week: string;
  status: SummaryRow['status'];
  skip_reason: SummaryRow['skipReason'];
  source: SummaryRow['source'];
  ai_failed: boolean;
  item_count: number;
  updated_at: string | Date;
  sent_at: string | Date | null;
  managed_by_me: boolean;
};

const LIST_STATUSES: Record<WeeklySummaryListQuery['status'], SummaryRow['status'][] | null> = {
  review: ['preparing', 'draft'],
  sent: ['sending', 'sent'],
  all: null,
};

export class InvalidSummaryCursorError extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidSummaryCursorError';
  }
}

const encodeCursor = (name: string, id: string) =>
  Buffer.from(JSON.stringify([name, id])).toString('base64url');

function decodeCursor(cursor: string): [string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string'
    ) {
      return [value[0], value[1]];
    }
  } catch {
    // falls through
  }
  throw new InvalidSummaryCursorError();
}

/**
 * One page of one week's summaries, keyset by `(group name, id)`. `groupIds` null = every
 * group. `weekly_summaries_week_status_group_idx`, the groups by their key.
 */
export function listSummariesSql(
  week: string,
  groupIds: string[] | null,
  managed: string[],
  status: WeeklySummaryListQuery['status'],
  cursor: [string, string] | null,
  limit: number,
): SQL {
  const statuses = LIST_STATUSES[status];
  const ids = (list: string[]) =>
    list.length === 0
      ? sql`array[]::text[]`
      : sql`array[${sql.join(
          list.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[]`;
  return sql`select s.id, s.group_id, g.name as group_name, s.week, s.status, s.skip_reason,
      s.source, s.ai_failed,
      (jsonb_array_length(s.content -> 'done') + jsonb_array_length(s.content -> 'waiting')
        + jsonb_array_length(s.content -> 'upcoming'))::int as item_count,
      s.updated_at, s.sent_at, (s.group_id = any(${ids(managed)})) as managed_by_me
    from weekly_summaries s join groups g on g.id = s.group_id
    where s.week = ${week}
      ${
        statuses
          ? sql`and s.status in (${sql.join(
              statuses.map((st) => sql`${st}`),
              sql`, `,
            )})`
          : sql``
      }
      ${groupIds ? sql`and s.group_id = any(${ids(groupIds)})` : sql``}
      ${cursor ? sql`and (g.name, s.id) > (${cursor[0]}, ${cursor[1]})` : sql``}
    order by g.name, s.id limit ${limit}`;
}

/** The list page (spec §7): `scope=mine` = the admin's groups; one who manages none sees all. */
export async function listSummaries(
  db: Db,
  adminId: string,
  query: WeeklySummaryListQuery & { week: string },
): Promise<{ rows: ListRow[]; nextCursor: string | null; managed: string[] }> {
  const managed = await managedGroupIds(db, adminId);
  const scope = query.scope === 'mine' && managed.length > 0 ? managed : null;
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const rows = [
    ...(await db.execute<ListRow>(
      listSummariesSql(query.week, scope, managed, query.status, cursor, query.limit + 1),
    )),
  ];
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.group_name, last.id) : null,
    managed,
  };
}

/** Drafts of the week in the groups the admin manages (the home card, spec §12.1). */
export async function pendingDraftCount(db: Db, adminId: string, week: string): Promise<number> {
  const managed = await managedGroupIds(db, adminId);
  if (managed.length === 0) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(weeklySummaries)
    .where(
      and(
        eq(weeklySummaries.week, week),
        eq(weeklySummaries.status, 'draft'),
        inArray(weeklySummaries.groupId, managed),
      ),
    );
  return row?.n ?? 0;
}

/** Drafts of earlier weeks in the admin's groups: they never vanish (spec §12.2). */
export async function olderDraftCount(db: Db, managed: string[], week: string): Promise<number> {
  if (managed.length === 0) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(weeklySummaries)
    .where(
      and(
        inArray(weeklySummaries.groupId, managed),
        eq(weeklySummaries.status, 'draft'),
        lt(weeklySummaries.week, week),
      ),
    );
  return row?.n ?? 0;
}

// ── Settings ─────────────────────────────────────────────────────────────────────────────────

/** A group's switch: on unless a manager turned it off. */
export async function getGroupSetting(db: Db, groupId: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: weeklySummaryGroupSettings.enabled })
    .from(weeklySummaryGroupSettings)
    .where(eq(weeklySummaryGroupSettings.groupId, groupId));
  return row?.enabled ?? true;
}

/** The switches of several groups (absent = on). */
export async function groupSettings(db: Db, groupIds: string[]): Promise<Map<string, boolean>> {
  if (groupIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(weeklySummaryGroupSettings)
    .where(inArray(weeklySummaryGroupSettings.groupId, groupIds));
  return new Map(rows.map((r) => [r.groupId, r.enabled]));
}

/**
 * Turning off does not touch an existing draft. With `audit`, the same transaction writes
 * `weekly_summary_setting.updated` when the switch changes (2026-10-19); the row is locked first,
 * so the "from" is the value this write replaces.
 */
export async function setGroupSetting(
  db: Db,
  groupId: string,
  enabled: boolean,
  actorId: string,
  audit?: { by: AuditActor; groupName: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = audit
      ? await tx
          .select({ enabled: weeklySummaryGroupSettings.enabled })
          .from(weeklySummaryGroupSettings)
          .where(eq(weeklySummaryGroupSettings.groupId, groupId))
          .for('update')
      : [];
    await tx
      .insert(weeklySummaryGroupSettings)
      .values({ groupId, enabled, updatedBy: actorId })
      .onConflictDoUpdate({
        target: weeklySummaryGroupSettings.groupId,
        set: { enabled, updatedBy: actorId, updatedAt: new Date() },
      });
    if (audit) {
      await recordSettingChanged(
        tx,
        audit.by,
        { id: groupId, name: audit.groupName },
        before?.enabled ?? true,
        enabled,
      );
    }
  });
}

export async function getRemind(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ remind: weeklySummaryAdminPrefs.remind })
    .from(weeklySummaryAdminPrefs)
    .where(eq(weeklySummaryAdminPrefs.userId, userId));
  return row?.remind ?? true;
}

export async function setRemind(db: Db, userId: string, remind: boolean): Promise<void> {
  await db
    .insert(weeklySummaryAdminPrefs)
    .values({ userId, remind })
    .onConflictDoUpdate({ target: weeklySummaryAdminPrefs.userId, set: { remind } });
}

/** The groups among `groupIds` the client turned the summary off for. */
export async function unsubscribedGroups(
  db: Db,
  userId: string,
  groupIds: string[],
): Promise<Set<string>> {
  if (groupIds.length === 0) return new Set();
  const rows = await db
    .select({ groupId: weeklySummaryUnsubscribes.groupId })
    .from(weeklySummaryUnsubscribes)
    .where(
      and(
        eq(weeklySummaryUnsubscribes.userId, userId),
        inArray(weeklySummaryUnsubscribes.groupId, groupIds),
      ),
    );
  return new Set(rows.map((r) => r.groupId));
}

/** Idempotent either way. */
export async function setSubscribed(
  db: Db,
  userId: string,
  groupId: string,
  subscribed: boolean,
): Promise<void> {
  if (subscribed) {
    await db
      .delete(weeklySummaryUnsubscribes)
      .where(
        and(
          eq(weeklySummaryUnsubscribes.userId, userId),
          eq(weeklySummaryUnsubscribes.groupId, groupId),
        ),
      );
  } else {
    await db.insert(weeklySummaryUnsubscribes).values({ userId, groupId }).onConflictDoNothing();
  }
}
