import { z } from 'zod';

/**
 * The Project and Event filters of the boards and ticket lists (Phase 33 part P2, spec §6,
 * decision 19). This file is part P2's (plan, "Conflict rules").
 *
 * A value is `none` (no project / no event) or an id. `event` needs a chosen project (not
 * `none`): the routes answer 400 `invalid_filter` otherwise (`isValidProjectFilter`).
 */
export const ProjectFilterValueSchema = z.string().trim().min(1).max(100);

/** `?project=<id>|none&event=<id>|none`, spread into the query schemas that take them. */
export const projectFilterFields = {
  project: ProjectFilterValueSchema.optional(),
  event: ProjectFilterValueSchema.optional(),
};

export type ProjectFilter = { project?: string; event?: string };

/** An event filter only under a chosen project. */
export function isValidProjectFilter(filter: ProjectFilter): boolean {
  return filter.event === undefined || (filter.project !== undefined && filter.project !== 'none');
}

/**
 * The project filter of the cross-client lists (the global board, the global tickets list): it
 * applies only with exactly one chosen client, since projects are per client.
 */
export function isValidGlobalProjectFilter(
  filter: ProjectFilter,
  clients: readonly string[] | 'all' | undefined,
): boolean {
  if (filter.event !== undefined) return false;
  if (filter.project === undefined) return true;
  return Array.isArray(clients) && clients.length === 1;
}

/** `PUT /api/tickets/:id/project`: the ticket's project and event; `projectId: null` clears both. */
export const TicketProjectBodySchema = z.object({
  projectId: z.string().min(1).max(100).nullable(),
  eventId: z.string().min(1).max(100).nullable().default(null),
});
export type TicketProjectBody = z.output<typeof TicketProjectBodySchema>;
