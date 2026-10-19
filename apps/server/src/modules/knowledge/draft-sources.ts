import { sql, type SQL } from 'drizzle-orm';
import { plainExcerpt } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { escapeLike } from '../../infra/text/search.js';
import { adminGroupIdSql } from '../groups/admin-group.js';
import { shareableItemCards } from './chat-items.js';

// "Navrhnúť odpoveď" (2026-10-19): the knowledge an AI draft of a ticket reply may use. Only what
// may be shown in the ticket's client: its own public items and the admin group's shareable ones,
// re-checked with `shareableItemCards` (the rule of a knowledge card in a chat). See
// docs/superpowers/specs/2026-10-19-ticket-ai-draft-design.md §5.

/** One knowledge item for the prompt. */
export type DraftKnowledgeItem = {
  id: string;
  type: 'note' | 'file' | 'link';
  title: string;
  /** The plain body (at most 3 000 characters), then the URL or the file names. */
  text: string;
  /** An admin-group item ("Spoločné"). */
  fromAdminGroup: boolean;
};

/** Candidates read before the sharing check drops some. */
const CANDIDATES = 20;
const TEXT_MAX = 3000;

/**
 * The candidates: public notes, files and links of `groupId` (null: none) and of the admin group
 * whose folded `search_text` holds any term (`knowledge_items_search_idx`), the most matching
 * terms first, then the latest change. File names come along (never the file contents).
 */
export function draftKnowledgeSql(input: { groupId: string | null; terms: string[] }): SQL {
  const likes = input.terms.map(
    (term) => sql`ki.search_text like ${`%${escapeLike(term)}%`} escape '\\'`,
  );
  const groupIds =
    input.groupId === null
      ? sql`(${adminGroupIdSql()})`
      : sql`(${input.groupId}, ${adminGroupIdSql()})`;
  return sql`
    select ki.id, ki.type, ki.title, ki.body, ki.url,
      (select string_agg(f.name, ', ' order by f.name)
        from knowledge_attachments ka join files f on f.id = ka.file_id
        where ka.item_id = ki.id) as file_names,
      (${sql.join(
        likes.map((like) => sql`(${like})::int`),
        sql` + `,
      )}) as score
    from knowledge_items ki
    where ki.group_id in ${groupIds}
      and ki.visibility = 'public'
      and ki.type in ('note', 'file', 'link')
      and (${sql.join(likes, sql` or `)})
    order by score desc, ki.updated_at desc, ki.id desc
    limit ${CANDIDATES}`;
}

type CandidateRow = {
  id: string;
  type: 'note' | 'file' | 'link';
  title: string;
  body: string;
  url: string | null;
  file_names: string | null;
};

/**
 * A place without a client (a ticket not matched yet): neither a client's id nor the admin
 * group's, so `shareableItemCards` keeps only the admin group's open items, as for a client.
 */
const NO_CLIENT = '';

/**
 * The knowledge of a draft: the best `limit` candidates that may be shown in the ticket's client
 * (for a ticket without a client: the admin group's shareable items only). No query without terms.
 */
export async function draftKnowledge(
  db: Db,
  input: { groupId: string | null; terms: string[]; limit: number },
): Promise<DraftKnowledgeItem[]> {
  if (input.terms.length === 0) return [];
  const rows = [...(await db.execute<CandidateRow>(draftKnowledgeSql(input)))];
  if (rows.length === 0) return [];
  const cards = await shareableItemCards(
    db,
    input.groupId ?? NO_CLIENT,
    rows.map((r) => r.id),
  );
  const items: DraftKnowledgeItem[] = [];
  for (const row of rows) {
    const card = cards.get(row.id);
    if (!card) continue;
    const lines = [plainExcerpt(row.body, () => undefined, TEXT_MAX)];
    if (row.url) lines.push(`URL: ${row.url}`);
    if (row.file_names) lines.push(`Súbory: ${row.file_names}`);
    items.push({
      id: row.id,
      type: row.type,
      title: row.title,
      text: lines.filter((l) => l !== '').join('\n'),
      fromAdminGroup: card.source === 'admin_group',
    });
    if (items.length === input.limit) break;
  }
  return items;
}
