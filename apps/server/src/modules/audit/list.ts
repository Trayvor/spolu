import { sql, type SQL } from 'drizzle-orm';
import type {
  AuditAction,
  AuditActorDto,
  AuditCategory,
  AuditChanges,
  AuditEgrantSource,
  AuditEntityType,
  AuditEntryDto,
  AuditPage,
  AuditQuery,
  SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { getGroupLabels } from '../groups/service.js';
import { namesOf } from '../users/service.js';
import { auditCategoriesFor } from './policy.js';
import { linkableIds } from './resolvers.js';

export class InvalidAuditFilterError extends Error {
  constructor(message = 'invalid audit filter') {
    super(message);
    this.name = 'InvalidAuditFilterError';
  }
}

export type AuditCursor = { createdAt: string; id: string };

/** Opaque base64url of `[created_at, id]`; `created_at` is Postgres' own text (microseconds). */
export function encodeAuditCursor(c: AuditCursor): string {
  return Buffer.from(JSON.stringify([c.createdAt, c.id])).toString('base64url');
}

export function decodeAuditCursor(s: string): AuditCursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string' &&
      value[1].length > 0 &&
      value[1].length <= 100 &&
      !Number.isNaN(Date.parse(value[0]))
    ) {
      return { createdAt: value[0], id: value[1] };
    }
  } catch {
    // falls through
  }
  throw new InvalidAuditFilterError('bad cursor');
}

const ZONE = 'Europe/Bratislava';

/**
 * The page query (spec §5.1, §6): every filter is a range scan of one index, newest first,
 * keyset by `(created_at, id)`; `limit + 1` rows tell whether there is a next page. Without the
 * finance category, `category = 'general'` (which also matches the partial index of the default
 * page). Exported for the EXPLAIN checks.
 */
export function auditPageSql(
  q: Omit<AuditQuery, 'limit' | 'cursor'>,
  categories: AuditCategory[],
  limit: number,
  cursor: AuditCursor | null = null,
): SQL {
  const where: SQL[] = [];
  if (!categories.includes('finance')) where.push(sql`category = 'general'`);
  if (q.entityType) where.push(sql`entity_type = ${q.entityType}`);
  if (q.entityId) where.push(sql`entity_id = ${q.entityId}`);
  if (q.group) where.push(sql`group_id = ${q.group}`);
  if (q.actor) {
    const a = q.actor;
    if (a.kind === 'user') where.push(sql`actor_user_id = ${a.id}`);
    else if (a.kind === 'token') where.push(sql`actor_token_id = ${a.id}`);
    else where.push(sql`actor_kind = ${a.kind}`);
  }
  if (q.from) {
    where.push(sql`created_at >= ((${q.from}::date)::timestamp at time zone ${ZONE})`);
  }
  if (q.to) {
    where.push(sql`created_at < (((${q.to}::date) + 1)::timestamp at time zone ${ZONE})`);
  }
  if (cursor) {
    where.push(sql`(created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id})`);
  }
  const clause = where.length > 0 ? sql`where ${sql.join(where, sql` and `)}` : sql``;
  return sql`select id, created_at, created_at::text as cursor_at, actor_kind, actor_user_id,
    actor_token_id, actor_label, actor_detail, entity_type, entity_id, entity_label, group_id,
    category, action, changes, cause_id
    from audit_log ${clause}
    order by created_at desc nulls last, id desc nulls last
    limit ${limit + 1}`;
}

type Row = {
  id: string;
  created_at: string | Date;
  cursor_at: string;
  actor_kind: 'user' | 'mcp' | 'egrant' | 'system';
  actor_user_id: string | null;
  actor_token_id: string | null;
  actor_label: string;
  actor_detail: string | null;
  entity_type: AuditEntityType;
  entity_id: string;
  entity_label: string;
  group_id: string | null;
  category: AuditCategory;
  action: AuditAction;
  changes: AuditChanges;
  cause_id: string | null;
};

type CauseRow = {
  id: string;
  entity_type: AuditEntityType;
  action: AuditAction;
  entity_label: string;
};

/**
 * One page of the log for the viewer: 1 query for the rows, then at most one `in (…)` query each
 * for the authors' current names, the groups' names, the causes and, per entity type present,
 * the live records (spec §10). A cause the viewer may not see (a finance row for a non-finance
 * admin) is left out.
 */
export async function listAudit(db: Db, viewer: SessionUser, q: AuditQuery): Promise<AuditPage> {
  const categories = auditCategoriesFor(viewer);
  const cursor = q.cursor ? decodeAuditCursor(q.cursor) : null;
  const rows = [...(await db.execute<Row>(auditPageSql(q, categories, q.limit, cursor)))];
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > q.limit && last
      ? encodeAuditCursor({ createdAt: last.cursor_at, id: last.id })
      : null;
  if (page.length === 0) return { items: [], nextCursor: null };

  const userIds = page.flatMap((r) => (r.actor_user_id ? [r.actor_user_id] : []));
  const groupIds = page.flatMap((r) => (r.group_id ? [r.group_id] : []));
  const causeIds = [...new Set(page.flatMap((r) => (r.cause_id ? [r.cause_id] : [])))];
  const byType = new Map<AuditEntityType, string[]>();
  for (const r of page)
    byType.set(r.entity_type, [...(byType.get(r.entity_type) ?? []), r.entity_id]);

  const [names, groups, causes, linkable] = await Promise.all([
    namesOf(db, userIds),
    getGroupLabels(db, groupIds),
    causeIds.length === 0
      ? Promise.resolve([] as CauseRow[])
      : db
          .execute<CauseRow>(
            sql`select id, entity_type, action, entity_label from audit_log
              where id in (${sql.join(
                causeIds.map((id) => sql`${id}`),
                sql`, `,
              )})${categories.includes('finance') ? sql`` : sql` and category = 'general'`}`,
          )
          .then((r) => [...r]),
    linkableIds(db, byType, categories),
  ]);
  const causeById = new Map(causes.map((c) => [c.id, c]));

  const items = page.map((r): AuditEntryDto => {
    const person = r.actor_user_id ? names.get(r.actor_user_id) : undefined;
    const group = r.group_id ? groups.get(r.group_id) : undefined;
    const cause = r.cause_id ? causeById.get(r.cause_id) : undefined;
    return {
      id: r.id,
      createdAt: new Date(r.created_at).toISOString(),
      actor: actorDto(r, person),
      entityType: r.entity_type,
      entityId: r.entity_id,
      entityLabel: r.entity_label,
      linkable: linkable.has(`${r.entity_type}:${r.entity_id}`),
      group: group && r.group_id ? { id: r.group_id, name: group.name } : null,
      action: r.action,
      changes: r.changes ?? {},
      cause: cause
        ? {
            id: cause.id,
            entityType: cause.entity_type,
            action: cause.action,
            entityLabel: cause.entity_label,
          }
        : null,
    };
  });
  return { items, nextCursor };
}

function actorDto(
  r: Row,
  person: { name: string; deactivated: boolean } | undefined,
): AuditActorDto {
  switch (r.actor_kind) {
    case 'user':
      return {
        kind: 'user',
        userId: r.actor_user_id!,
        name: person?.name ?? r.actor_label,
        deactivated: person?.deactivated ?? false,
      };
    case 'mcp':
      return {
        kind: 'mcp',
        userId: r.actor_user_id!,
        name: person?.name ?? r.actor_label,
        tokenId: r.actor_token_id!,
        tokenName: r.actor_detail ?? '',
        deactivated: person?.deactivated ?? false,
      };
    case 'egrant':
      return {
        kind: 'egrant',
        source: (r.actor_detail ?? 'groups') as AuditEgrantSource,
        instance: r.actor_label,
      };
    case 'system':
      return { kind: 'system', job: r.actor_label };
  }
}
