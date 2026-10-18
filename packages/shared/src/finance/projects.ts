import { z } from 'zod';
import {
  isValidProjectFilter,
  projectFilterFields,
  type ProjectFilter,
} from '../projects/filters.js';

/**
 * Finance by project and event (Phase 33 part P6, spec §11, decisions 23–25). This file is P6's.
 *
 * The client's Overview and Work log take `?project=<id>|none&event=<id>|none` (an event only
 * under a chosen project), the boards' filter values (`projectFilterFields`). `/finance` takes
 * `project` only while exactly one client is chosen, and never `event` (decision 24).
 */

/** `?project=&event=` of `GET /api/groups/:id/finance/overview` and `…/work-log`. */
export const FinanceProjectQuerySchema = z
  .object(projectFilterFields)
  .refine(isValidProjectFilter, { message: 'an event needs its project' });
export type FinanceProjectQuery = z.output<typeof FinanceProjectQuerySchema>;

/** `/finance`: `project` with exactly one chosen client, no `event` (decision 24). */
export function isValidSystemProjectFilter(
  filter: ProjectFilter,
  clients: readonly string[],
): boolean {
  if (filter.event !== undefined) return false;
  return filter.project === undefined || clients.length === 1;
}

/** A project or event id as the finance bodies take it (the projects module's ids). */
export const FinanceProjectIdSchema = z.string().min(1).max(100);

/**
 * The project and event of a manual entry (`POST …/time-entries`, `PATCH /api/finance/time-
 * entries/:id`): both optional, an event only with its project; the server checks that they
 * belong to the entry's client (`400 invalid_project`).
 */
export const manualEntryProjectFields = {
  projectId: FinanceProjectIdSchema.nullable().default(null),
  eventId: FinanceProjectIdSchema.nullable().default(null),
};

/** True when an event comes without its project (the bodies refuse it). */
export const eventWithoutProject = (v: { projectId?: string | null; eventId?: string | null }) =>
  (v.eventId ?? null) !== null && (v.projectId ?? null) === null;
