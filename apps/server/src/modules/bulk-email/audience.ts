import { sql, type SQL } from 'drizzle-orm';
import {
  BULK_LIMITS,
  BULK_PEOPLE_SEARCH,
  type BulkAudience,
  type BulkAudienceCount,
  type BulkAudiencePage,
  type BulkPerson,
  type MemberRole,
  type UserLanguage,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { managedGroupsOfSql } from '../groups/managers.js';
import {
  activeGroupNamesSql,
  activeMemberIdsSql,
  hasActiveRoleSql,
} from '../groups/memberships.js';
import { escapeLike } from '../../infra/text/search.js';
import { InvalidCursorError } from './errors.js';

/**
 * Who gets a campaign (spec §2). Every read here is one SQL statement over the `"user"` row
 * aliased `u`; memberships and managers come through the groups module's SQL helpers.
 */

/** A person a campaign would be sent to, as copied into `bulk_recipients` when sending starts. */
export type AudienceRecipient = {
  userId: string;
  email: string;
  name: string;
  language: UserLanguage;
};

const list = (ids: string[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

/**
 * The group scope as a condition on a group id column: `groupIds` ∪ the groups managed by
 * `managerIds`; null (every group) when both lists are empty.
 */
function groupScope(audience: BulkAudience): ((column: SQL) => SQL) | null {
  const { groupIds, managerIds } = audience;
  if (groupIds.length === 0 && managerIds.length === 0) return null;
  return (column) => {
    const parts: SQL[] = [];
    if (groupIds.length > 0) parts.push(sql`${column} in (${list(groupIds)})`);
    if (managerIds.length > 0) parts.push(sql`${column} in ${managedGroupsOfSql(managerIds)}`);
    return sql`(${sql.join(parts, sql` or `)})`;
  };
}

/**
 * The audience as a condition on `u`: matched by role in the group scope, an admin when `admin`
 * is ticked (the scope does not apply to admins), or included by hand; minus the excluded.
 * Disabled and unsubscribed people still match here; they are "left out" later.
 */
function matchesSql(audience: BulkAudience): SQL {
  const any: SQL[] = [];
  const memberRoles = audience.roles.filter((r): r is MemberRole => r !== 'admin');
  if (memberRoles.length > 0) {
    any.push(sql`u.id in ${activeMemberIdsSql([...new Set(memberRoles)], groupScope(audience))}`);
  }
  if (audience.roles.includes('admin')) any.push(sql`u.role in ('admin', 'superadmin')`);
  if (audience.includeUserIds.length > 0) {
    any.push(sql`u.id in (${list(audience.includeUserIds)})`);
  }
  if (any.length === 0) return sql`false`;
  const matched = sql`(${sql.join(any, sql` or `)})`;
  if (audience.excludeUserIds.length === 0) return matched;
  return sql`${matched} and u.id not in (${list(audience.excludeUserIds)})`;
}

/** Not disabled and not unsubscribed; needs `bulk_subscriptions s` left-joined on `u`. */
const deliverable = sql`u.disabled_at is null and s.subscribed is not false`;
const subscriptionJoin = sql`left join bulk_subscriptions s on s.user_id = u.id`;

/**
 * `select user_id, email, name, language` of the people who get the campaign (matched, not
 * disabled, not unsubscribed), each once: the source of the one `insert … select` of
 * `bulk_recipients` when sending starts.
 */
export function recipientsSql(audience: BulkAudience): SQL {
  return sql`select u.id as user_id, u.email, u.name, u.language
    from "user" u ${subscriptionJoin}
    where ${matchesSql(audience)} and ${deliverable}`;
}

/** The people who get the campaign, by id. */
export async function resolveAudience(
  db: Db,
  audience: BulkAudience,
): Promise<AudienceRecipient[]> {
  const rows = await db.execute<{
    user_id: string;
    email: string;
    name: string;
    language: UserLanguage;
  }>(sql`${recipientsSql(audience)} order by u.id`);
  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.name,
    language: r.language,
  }));
}

/** How many people get it, and how many matched but are left out, per reason; one query. */
export async function countAudience(db: Db, audience: BulkAudience): Promise<BulkAudienceCount> {
  const [row] = await db.execute<{ count: number; unsubscribed: number; disabled: number }>(sql`
    select
      count(*) filter (where ${deliverable})::int as count,
      count(*) filter (where u.disabled_at is null and s.subscribed = false)::int as unsubscribed,
      count(*) filter (where u.disabled_at is not null)::int as disabled
    from "user" u ${subscriptionJoin}
    where ${matchesSql(audience)}`);
  return {
    count: row?.count ?? 0,
    leftOut: { unsubscribed: row?.unsubscribed ?? 0, disabled: row?.disabled ?? 0 },
  };
}

type PersonRow = {
  id: string;
  name: string;
  email: string;
  role: BulkPerson['role'];
  groups: string[];
};

/** The `BulkPerson` columns of `u`. */
const personColumns = sql`u.id, u.name, u.email,
  case when u.role in ('admin', 'superadmin') then 'admin'
    when not ${hasActiveRoleSql(sql`u.id`, 'client')} and ${hasActiveRoleSql(sql`u.id`, 'ziadatel')}
    then 'ziadatel' else 'client' end as role,
  ${activeGroupNamesSql(sql`u.id`)} as groups`;

const toPerson = (r: PersonRow): BulkPerson => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  groups: r.groups,
});

function encodeCursor(row: PersonRow): string {
  return Buffer.from(JSON.stringify([row.name, row.id])).toString('base64url');
}

function cursorWhere(cursor: string): SQL {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw new InvalidCursorError();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    parsed[0].length > 500 ||
    parsed[1].length === 0 ||
    parsed[1].length > 100
  ) {
    throw new InvalidCursorError();
  }
  return sql`(u.name, u.id) > (${parsed[0]}, ${parsed[1]})`;
}

/** The people who get the campaign, by name, `BULK_LIMITS.pageSize` a page; one query. */
export async function listAudience(
  db: Db,
  audience: BulkAudience,
  cursor?: string,
): Promise<BulkAudiencePage> {
  const size = BULK_LIMITS.pageSize;
  const after = cursor ? sql` and ${cursorWhere(cursor)}` : sql``;
  const rows = [
    ...(await db.execute<PersonRow>(sql`select ${personColumns}
      from "user" u ${subscriptionJoin}
      where ${matchesSql(audience)} and ${deliverable}${after}
      order by u.name, u.id limit ${size + 1}`)),
  ];
  const page = rows.slice(0, size);
  return {
    items: page.map(toPerson),
    nextCursor: rows.length > size ? encodeCursor(page[page.length - 1]!) : null,
  };
}

/**
 * The pickers' people search: active people whose name or email contains `q` (case-insensitive),
 * by name, at most `BULK_PEOPLE_SEARCH.limit`. The `user` table holds hundreds to a few thousand
 * rows, so a scan is fine.
 */
export async function searchPeople(db: Db, q: string): Promise<BulkPerson[]> {
  const term = `%${escapeLike(q.trim())}%`;
  const rows = await db.execute<PersonRow>(sql`select ${personColumns} from "user" u
    where u.disabled_at is null
      and (u.name ilike ${term} escape '\\' or u.email ilike ${term} escape '\\')
    order by u.name, u.id limit ${BULK_PEOPLE_SEARCH.limit}`);
  return rows.map(toPerson);
}

/** The people behind saved ids, disabled ones included, by name; unknown ids are left out. */
export async function lookupPeople(db: Db, ids: string[]): Promise<BulkPerson[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db.execute<PersonRow>(sql`select ${personColumns} from "user" u
    where u.id in (${list(unique)}) order by u.name, u.id`);
  return rows.map(toPerson);
}
