import { sql } from 'drizzle-orm';
import { plainExcerpt } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { registerReminderSubject, type SubjectInfo } from '../reminders/subjects.js';
import { isAdmin } from '../users/policy.js';
import { canReadItem } from './policy.js';

type SubjectRow = {
  id: string;
  group_id: string;
  type: string;
  title: string;
  body: string;
  visibility: string;
  created_by: string;
  /** Names of the people of the item's group mentioned in the body, for the plain-text body. */
  mention_names: Record<string, string> | null;
};

/** Knowledge items as reminder subjects: one query for any number of ids. */
async function loadMany(db: Db, ids: string[]): Promise<Map<string, SubjectInfo>> {
  const map = new Map<string, SubjectInfo>();
  if (ids.length === 0) return map;
  const rows = await db.execute<SubjectRow>(sql`
    select k.id, k.group_id, k.type, k.title, k.body, k.visibility, k.created_by,
           (select jsonb_object_agg(m.id, m.name) from "user" m
             where m.id in (select (regexp_matches(k.body, '<@([A-Za-z0-9_-]+)>', 'g'))[1])
               and (m.role <> 'client' or exists (select 1 from group_members gm
                     where gm.user_id = m.id and gm.group_id = k.group_id
                       and gm.role = 'client' and gm.removed_at is null))) as mention_names
    from knowledge_items k
    where k.id in (${sql.join(ids, sql`, `)})`);
  for (const row of rows) {
    const names = row.mention_names ?? {};
    const item = { groupId: row.group_id, visibility: row.visibility };
    map.set(row.id, {
      groupId: row.group_id,
      title: row.title,
      // Plain text for the calendar export: mentions as names, whitespace collapsed.
      body: plainExcerpt(row.body, (id) => names[id], Number.POSITIVE_INFINITY),
      adminsOnly: row.visibility === 'admins',
      meeting: row.type === 'meeting',
      active: true,
      authorId: row.created_by,
      link: `/groups/${row.group_id}/knowledge?k=${row.id}`,
      canRead: (actor, actorGroupIds) => canReadItem(actor, item, actorGroupIds),
      canEdit: (actor) => isAdmin(actor) || actor.id === row.created_by,
    });
  }
  return map;
}

/** Registers the `knowledge` kind (endpoints under `/api/knowledge/:id/reminders`). Idempotent. */
export function registerKnowledgeReminderSubject(): void {
  registerReminderSubject({ kind: 'knowledge', routePrefix: 'knowledge', loadMany });
}
