import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { escapeLike } from '../../infra/text/search.js';

// "Navrhnúť odpoveď" (2026-10-19): resolved tickets of any client that look like the one being
// answered, as examples for the AI draft (owner decision: all clients, masked before sending).
// See docs/superpowers/specs/2026-10-19-ticket-ai-draft-design.md §5.

/** A similar resolved ticket; the group and requester fields are for masking only, never sent. */
export type SimilarTicket = {
  id: string;
  number: number;
  subject: string | null;
  /** The first 1 000 characters of the body. */
  bodyHead: string;
  groupId: string | null;
  groupName: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  requesterPhone: string | null;
};

const BODY_HEAD = 1000;

/**
 * Resolved tickets other than `ticketId` whose folded subject or folded body start holds any term
 * (`tickets_subject_fold_trgm_idx`, `tickets_body_head_fold_trgm_idx`). Score: a subject match
 * counts twice. Best score first, then the ticket's own client, then the latest resolved.
 */
export function similarResolvedTicketsSql(input: {
  ticketId: string;
  groupId: string | null;
  terms: string[];
  limit: number;
}): SQL {
  const subject = sql`spolu_fold(t.subject)`;
  const head = sql`spolu_fold(left(t.body, 200))`;
  const patterns = input.terms.map((term) => `%${escapeLike(term)}%`);
  const matches = patterns.flatMap((p) => [
    sql`${subject} like ${p} escape '\\'`,
    sql`${head} like ${p} escape '\\'`,
  ]);
  const score = sql.join(
    patterns.map(
      (p) =>
        sql`2 * coalesce(${subject} like ${p} escape '\\', false)::int + coalesce(${head} like ${p} escape '\\', false)::int`,
    ),
    sql` + `,
  );
  return sql`
    select t.id, t.number, t.subject, left(t.body, ${BODY_HEAD}) as body_head, t.group_id,
      g.name as group_name, t.requester_name, t.requester_email, t.requester_phone,
      (${score}) as score
    from tickets t
    left join groups g on g.id = t.group_id
    where t.status = 'resolved' and t.id <> ${input.ticketId}
      and (${sql.join(matches, sql` or `)})
    order by score desc, (t.group_id is not distinct from ${input.groupId}) desc,
      t.resolved_at desc nulls last, t.id
    limit ${input.limit}`;
}

type Row = {
  id: string;
  number: number;
  subject: string | null;
  body_head: string | null;
  group_id: string | null;
  group_name: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
};

/** The similar resolved tickets of a draft (of every client); no query without terms. */
export async function similarResolvedTickets(
  db: Db,
  input: { ticketId: string; groupId: string | null; terms: string[]; limit: number },
): Promise<SimilarTicket[]> {
  if (input.terms.length === 0) return [];
  const rows = await db.execute<Row>(similarResolvedTicketsSql(input));
  return [...rows].map((r) => ({
    id: r.id,
    number: Number(r.number),
    subject: r.subject,
    bodyHead: r.body_head ?? '',
    groupId: r.group_id,
    groupName: r.group_name,
    requesterName: r.requester_name,
    requesterEmail: r.requester_email,
    requesterPhone: r.requester_phone,
  }));
}
