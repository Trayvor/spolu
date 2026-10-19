import type { CardTarget } from './count-card';

/**
 * The links of the "Team workload" card's numbers (2026-10-19). `groupId`: a client, `all` (an
 * admin's row: every client) or null ("Bez klienta", no link).
 */
type Row = { self: boolean; groupId: string | null | 'all' };

/** Úlohy (and Po termíne with `overdue`): the global board for that admin and client. */
export function taskLink(row: Row & { userId: string }, overdue: boolean): CardTarget | null {
  if (row.groupId === null) return null;
  return {
    to: '/tasks',
    search: {
      clients: row.groupId,
      assignee: row.self ? 'me' : row.userId,
      ...(overdue ? { due: 'overdue' } : {}),
    },
  };
}

/**
 * Tikety: only on the viewer's own rows, since the ticket list has no "another person" filter
 * yet (spec open question 4). The list takes `clients=all` for every client.
 */
export function ticketLink(row: Row): CardTarget | null {
  if (!row.self || row.groupId === null) return null;
  return { to: '/tickets', search: { assignee: 'me', clients: row.groupId } };
}
