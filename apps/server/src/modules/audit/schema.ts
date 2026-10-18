import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { AuditCategory, AuditChanges } from '@spolu/shared';

/**
 * The audit log (spec 2026-10-19-audit-log-design.md §5): one append-only row per changed
 * record per write. No foreign keys, on purpose: the log outlives the records it describes, and
 * a delete elsewhere must never cascade into it or be blocked by it; labels are snapshots for the
 * same reason. The trigger `audit_log_append_only` (migration) refuses every UPDATE (except the
 * anonymize setting's labels) and a DELETE of a row younger than 730 days.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    actorKind: text('actor_kind').$type<'user' | 'mcp' | 'egrant' | 'system'>().notNull(),
    /** The person (`user`, `mcp`). No FK. */
    actorUserId: text('actor_user_id'),
    /** The MCP token (`mcp`). No FK. */
    actorTokenId: text('actor_token_id'),
    /** Snapshot: the person's name, the eGrant instance's origin or the job's name. */
    actorLabel: text('actor_label').notNull(),
    /** Snapshot: the token's name (`mcp`), the eGrant source (`egrant`). */
    actorDetail: text('actor_detail'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** Snapshot, at most 200 characters. */
    entityLabel: text('entity_label').notNull(),
    /** The client group the record belonged to at the change; null for admins, tokens, … */
    groupId: text('group_id'),
    category: text('category').$type<AuditCategory>().notNull().default('general'),
    action: text('action').notNull(),
    changes: jsonb('changes').$type<AuditChanges>().notNull().default({}),
    /** The row this one is a consequence of. No FK. */
    causeId: text('cause_id'),
  },
  (t) => [
    check('audit_log_actor_kind_check', sql`${t.actorKind} in ('user', 'mcp', 'egrant', 'system')`),
    check('audit_log_category_check', sql`${t.category} in ('general', 'finance')`),
    check(
      'audit_log_actor_check',
      sql`(${t.actorKind} in ('user', 'mcp')) = (${t.actorUserId} is not null)`,
    ),
    check('audit_log_token_check', sql`(${t.actorKind} = 'mcp') = (${t.actorTokenId} is not null)`),
    check('audit_log_changes_size_check', sql`pg_column_size(${t.changes}) <= 16384`),
    index('audit_log_created_idx').on(t.createdAt.desc(), t.id.desc()),
    index('audit_log_entity_idx').on(t.entityType, t.entityId, t.createdAt.desc(), t.id.desc()),
    index('audit_log_type_idx').on(t.entityType, t.createdAt.desc(), t.id.desc()),
    index('audit_log_group_idx')
      .on(t.groupId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.groupId} is not null`),
    index('audit_log_actor_user_idx')
      .on(t.actorUserId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.actorUserId} is not null`),
    index('audit_log_actor_token_idx')
      .on(t.actorTokenId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.actorTokenId} is not null`),
    index('audit_log_actor_kind_idx')
      .on(t.actorKind, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.actorKind} <> 'user'`),
    index('audit_log_general_created_idx')
      .on(t.createdAt.desc(), t.id.desc())
      .where(sql`${t.category} = 'general'`),
    index('audit_log_cause_idx')
      .on(t.causeId)
      .where(sql`${t.causeId} is not null`),
  ],
);
