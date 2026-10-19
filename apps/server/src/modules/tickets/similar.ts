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
 *
 * 2026-10-19: one indexed branch per term and text (`union all`, weight 2 for the subject, 1 for
 * the body start), summed per ticket. Each branch folds only its own text, once per candidate in
 * the index recheck; one `where` with every term and a score beside it folded each ticket's texts
 * up to twelve times (115 ms for 25 714 candidates on the search volume, now about 30 ms). The
 * ids group under "C" (byte equality, so the same groups, without the collation's cost); the
 * order and the rows are those of before.
 */
export function similarResolvedTicketsSql(input: {
  ticketId: string;
  groupId: string | null;
  terms: string[];
  limit: number;
}): SQL {
  const patterns = input.terms.map((term) => `%${escapeLike(term)}%`);
  const hits = patterns.flatMap((p) => [
    sql`select t.id, t.group_id, t.resolved_at, 2 as w from tickets t
      where t.status = 'resolved' and t.id <> ${input.ticketId}
        and spolu_fold(t.subject) like ${p} escape '\\'`,
    sql`select t.id, t.group_id, t.resolved_at, 1 as w from tickets t
      where t.status = 'resolved' and t.id <> ${input.ticketId}
        and spolu_fold(left(t.body, 200)) like ${p} escape '\\'`,
  ]);
  return sql`
    select t.id, t.number, t.subject, left(t.body, ${BODY_HEAD}) as body_head, t.group_id,
      g.name as group_name, t.requester_name, t.requester_email, t.requester_phone, c.score
    from (
      select min(h.id) as id, min(h.group_id) as group_id, max(h.resolved_at) as resolved_at,
        sum(h.w)::int as score
      from (${sql.join(hits, sql` union all `)}) h
      group by h.id collate "C"
      order by score desc, (min(h.group_id) is not distinct from ${input.groupId}) desc,
        max(h.resolved_at) desc nulls last, min(h.id)
      limit ${input.limit}
    ) c
    join tickets t on t.id = c.id
    left join groups g on g.id = t.group_id
    order by c.score desc, (c.group_id is not distinct from ${input.groupId}) desc,
      c.resolved_at desc nulls last, c.id`;
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
