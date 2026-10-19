import { sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * Test-only: the audit log volume of spec §10 for the EXPLAIN checks (ADR 0040), seeded once into
 * a template database: 2 000 000 rows spread evenly over the last 730 days (newest first by
 * number: row 1 is now), 3 000 groups, 60 admins, 20 tokens; 5 % finance, 3 % eGrant, 2 % MCP,
 * 1 % system; entity types weighted like real use (task 45 %, ticket 15 %, knowledge 12 %,
 * membership 6 %, …); `changes` about 100 bytes. Row `i`: group `i % 3000`, admin `i % 60`,
 * token `i % 20`; a task's entity id is `t<i % 30000>`, so one task has about 30 rows.
 */

const ROWS = 2_000_000;
const DAYS = 730;
export const AUDIT_VOLUME_TABLES = ['audit_log'];

export const AUDIT_VOLUME = { rows: ROWS, days: DAYS } as const;

export type AuditVolumeIds = {
  groupId: string;
  adminId: string;
  tokenId: string;
  taskId: string;
};

export function auditVolumeIds(): AuditVolumeIds {
  return { groupId: 'vol-g-7', adminId: 'vol-a-7', tokenId: 'vol-t-7', taskId: 't707' };
}

export async function seedAuditVolume(tx: Db): Promise<void> {
  // The append-only trigger only guards UPDATE and DELETE: the seed inserts.
  await tx.execute(sql`
    insert into audit_log (id, created_at, actor_kind, actor_user_id, actor_token_id, actor_label,
      actor_detail, entity_type, entity_id, entity_label, group_id, category, action, changes)
    select
      'va-' || lpad(i::text, 7, '0'),
      now() - make_interval(secs => i * ${(DAYS * 86_400) / ROWS}::float8),
      k.kind,
      case when k.kind in ('user', 'mcp') then 'vol-a-' || (i % 60) end,
      case when k.kind = 'mcp' then 'vol-t-' || (i % 20) end,
      case k.kind when 'egrant' then 'https://vol' || (i % 3000) || '.egrant.sk'
        when 'system' then 'knowledge.meeting-series' else 'Admin ' || (i % 60) end,
      case k.kind when 'mcp' then 'Claude' when 'egrant' then 'groups' end,
      t.type,
      case t.type when 'task' then 't' || (i % 30000) else left(t.type, 2) || (i % 50000) end,
      'Label ' || (i % 1000),
      case when t.type in ('admin', 'rate', 'finance_access', 'mcp_token', 'passkey') then null
        else 'vol-g-' || (i % 3000) end,
      case when t.type in ('finance_item', 'rate', 'time_entry', 'finance_access')
        then 'finance' else 'general' end,
      case when t.type in ('task', 'ticket', 'knowledge_item', 'project', 'finance_item',
        'time_entry') then 'updated' when t.type = 'membership' then 'added'
        when t.type = 'rate' then 'created' when t.type = 'finance_access' then 'granted'
        when t.type = 'group' then 'updated' else 'created' end,
      jsonb_build_object('title', jsonb_build_object('from', 'Old ' || (i % 97),
        'to', 'New ' || (i % 89)), 'description', jsonb_build_object('changed', true))
    from generate_series(1::bigint, ${ROWS}::bigint) i
    cross join lateral (select case
      when i % 100 < 2 then 'mcp' when i % 100 < 5 then 'egrant' when i % 100 = 5 then 'system'
      else 'user' end as kind) k
    cross join lateral (select case
      when i % 20 = 0 then (array['finance_item', 'time_entry', 'rate', 'finance_access'])[((i / 20) % 4 + 1)::int]
      else (case ((i * 7919) % 95)
        when 0 then 'admin' when 1 then 'manager' when 2 then 'bucket' when 3 then 'passkey'
        when 4 then 'mcp_token' when 5 then 'bulk_campaign' when 6 then 'knowledge_folder'
        when 7 then 'knowledge_folder' else null end) end as pick) p
    cross join lateral (select coalesce(p.pick, case
      when (i * 31) % 100 < 50 then 'task' when (i * 31) % 100 < 67 then 'ticket'
      when (i * 31) % 100 < 80 then 'knowledge_item' when (i * 31) % 100 < 87 then 'membership'
      when (i * 31) % 100 < 90 then 'group' when (i * 31) % 100 < 95 then 'project'
      else 'project_event' end) as type) t`);
}
