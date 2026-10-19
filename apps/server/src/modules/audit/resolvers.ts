import { auditCategoryOf, type AuditCategory, type AuditEntityType } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

/**
 * Whether the live records of an entity type still exist (the page links to them). Each module
 * registers its own (like `registerChannelKind`), so the audit module never reads another
 * module's table; finance registers its own types, which keeps the finance seal.
 */
export type AuditResolver = { existingIds(db: Db, ids: string[]): Promise<Set<string>> };

const resolvers = new Map<AuditEntityType, AuditResolver>();

export function registerAuditResolver(type: AuditEntityType, resolver: AuditResolver): void {
  resolvers.set(type, resolver);
}

/**
 * The ids (of the given ones, by type) whose record still exists: one query per type present,
 * none for a type without a resolver, and none for a finance type unless the viewer's categories
 * include finance.
 */
export async function linkableIds(
  db: Db,
  byType: Map<AuditEntityType, string[]>,
  categories: AuditCategory[],
): Promise<Set<string>> {
  const found = new Set<string>();
  await Promise.all(
    [...byType].map(async ([type, ids]) => {
      if (ids.length === 0 || !categories.includes(auditCategoryOf(type))) return;
      const resolver = resolvers.get(type);
      if (!resolver) return;
      for (const id of await resolver.existingIds(db, [...new Set(ids)]))
        found.add(`${type}:${id}`);
    }),
  );
  return found;
}
