import { sql, type SQL } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { KNOWLEDGE_LIMITS } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { emitKnowledgeItem } from './events.js';
import { sourceFileSummaries } from './service.js';

/**
 * "From ticket" and "From task" (2026-10-22): every file uploaded with a ticket (the manual form
 * or the intake) and every file attached to a task card is one knowledge item of the group,
 * like a chat file. The tickets and tasks services call these in the transaction that writes the
 * attachment rows; the items cascade from those rows (`knowledge_items_ticket_attachment_fk`,
 * `..._task_attachment_fk`), so removing a file, deleting the task or the ticket removes them.
 *
 * Who reads them is who reads the source: admins and the group's clients read every ticket and
 * every task of the group (a ziadatel reads no knowledge), so an item is public; an item of the
 * admin group (its tasks; it has no tickets) or of an admins-only file is "Only eGrant". A
 * finance file never becomes one. Migration 0072 backfilled the existing files with the same SQL.
 */

const VISIBILITY = sql`case when f.admins_only or g.kind = 'admin' then 'admins' else 'public' end`;
const SEARCH_TEXT = sql`btrim(regexp_replace(spolu_fold(f.name), '\\s+', ' ', 'g'))`;
const ids = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/**
 * The entries of a ticket's files that are still missing, in the ticket's group; nothing while
 * the ticket has no client. Their author is the uploader, else the initiator or the creator of the
 * ticket (an intake file has no uploader), else the first superadmin.
 */
function insertTicketFiles(ticketId: string): SQL {
  return sql`
    insert into knowledge_items (id, group_id, type, visibility, title, body, url, folder_id,
      created_by, created_at, updated_at, search_text, source_ticket_id, source_file_id)
    select gen_random_uuid()::text, t.group_id, 'ticket_file', ${VISIBILITY},
           left(f.name, ${KNOWLEDGE_LIMITS.title}), '', null, null, w.author_id,
           t.created_at, t.created_at, ${SEARCH_TEXT}, a.ticket_id, a.file_id
    from ticket_attachments a
    join tickets t on t.id = a.ticket_id
    join groups g on g.id = t.group_id
    join files f on f.id = a.file_id
    cross join lateral (
      select coalesce(f.uploaded_by, t.requester_user_id, t.created_by,
        (select u.id from "user" u where u.role = 'superadmin'
         order by u.created_at, u.id limit 1)) as author_id) w
    where a.ticket_id = ${ticketId} and not f.finance_only and w.author_id is not null
    on conflict do nothing`;
}

/** The entries of these tasks' card files that are still missing; the author is the uploader. */
function insertTaskFiles(taskIds: readonly string[]): SQL {
  return sql`
    insert into knowledge_items (id, group_id, type, visibility, title, body, url, folder_id,
      created_by, created_at, updated_at, search_text, source_task_id, source_file_id)
    select gen_random_uuid()::text, t.group_id, 'task_file', ${VISIBILITY},
           left(f.name, ${KNOWLEDGE_LIMITS.title}), '', null, null,
           coalesce(f.uploaded_by, t.created_by),
           coalesce(f.attached_at, t.created_at), coalesce(f.attached_at, t.created_at),
           ${SEARCH_TEXT}, a.task_id, a.file_id
    from task_attachments a
    join tasks t on t.id = a.task_id
    join groups g on g.id = t.group_id
    join files f on f.id = a.file_id
    where a.task_id in (${ids(taskIds)}) and not f.finance_only
    on conflict do nothing`;
}

/**
 * Brings a ticket's entries in line with its files and its client, in the caller's transaction:
 * after its files were attached, and after it got (or changed) its client. Entries already there
 * move to the ticket's group (a ticket keeps its files when it moves); missing ones are added.
 */
export async function syncTicketFiles(tx: Db, ticketId: string): Promise<void> {
  await tx.execute(sql`
    update knowledge_items k set group_id = t.group_id, updated_at = now()
    from tickets t
    where t.id = ${ticketId} and k.source_ticket_id = t.id and t.group_id is not null
      and k.group_id <> t.group_id`);
  await tx.execute(insertTicketFiles(ticketId));
}

/** Adds the missing entries of these tasks' card files, in the caller's transaction. */
export async function syncTaskFiles(tx: Db, taskIds: readonly string[]): Promise<void> {
  if (taskIds.length === 0) return;
  await tx.execute(insertTaskFiles(taskIds));
}

/** After the commit: pushes a ticket's entries to their readers (`knowledge:item`). */
export async function emitTicketFileItems(
  db: Db,
  io: SocketIOServer,
  ticketId: string,
): Promise<void> {
  const where = sql`k.source_ticket_id = ${ticketId}`;
  for (const item of await sourceFileSummaries(db, where)) emitKnowledgeItem(io, item);
}

/** After the commit: pushes these tasks' entries to their readers (`knowledge:item`). */
export async function emitTaskFileItems(
  db: Db,
  io: SocketIOServer,
  taskIds: readonly string[],
): Promise<void> {
  if (taskIds.length === 0) return;
  const where = sql`k.source_task_id in (${ids(taskIds)})`;
  for (const item of await sourceFileSummaries(db, where)) emitKnowledgeItem(io, item);
}
