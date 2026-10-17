import { z } from 'zod';
import { PROJECT_LIMITS } from './common.js';

/**
 * eGrant's project endpoint, the ticket intake's `project_id` and the review of changes from
 * eGrant (Phase 33 part P3, spec §5). Written by P1 so the parts share one shape; P3 refines
 * only this file (it joins `EgrantProjectIdField` into `TicketIntakeBodySchema`).
 */

export const EGRANT_PROJECT_LIMITS = {
  events: 200,
  /** Body of `PUT /api/egrant/projects/:project_id`. */
  bodyBytes: 1024 * 1024,
  /** Deliveries for an instance without a client are kept this long. */
  inboxDays: 180,
} as const;

/**
 * A strict `dd.mm.yyyy` date (spec §5.3) as `YYYY-MM-DD`, or null when it is not one or not a
 * real calendar day (`31.02.2026`).
 */
export function parseEgrantDate(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const iso = `${yyyy}-${mm}-${dd}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

const plainText = z
  .string()
  .max(PROJECT_LIMITS.description)
  .nullish()
  .transform((v) => v ?? '');

/**
 * An event as eGrant sends it. The name and the date are checked per event by the delivery, not
 * here: an invalid date or an empty name skips that event, never the request (spec §5.3).
 */
export const EgrantEventBodySchema = z.object({
  name: z
    .string()
    .max(PROJECT_LIMITS.name)
    .nullish()
    .transform((v) => (v ?? '').trim()),
  date: z
    .string()
    .max(20)
    .nullish()
    .transform((v) => (v ?? '').trim()),
  description: plainText,
});
export type EgrantEventBody = z.infer<typeof EgrantEventBodySchema>;

/** The body of `PUT /api/egrant/projects/:project_id` (spec §5.1): the project's full state. */
export const EgrantProjectBodySchema = z.object({
  instance_url: z.string().trim().min(1).max(2048),
  sent_at: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(1).max(PROJECT_LIMITS.name),
  description: plainText,
  events: z.array(EgrantEventBodySchema).max(EGRANT_PROJECT_LIMITS.events),
});
export type EgrantProjectBody = z.infer<typeof EgrantProjectBodySchema>;

/** eGrant's project id, in the URL of the project endpoint and as the intake's `project_id`. */
export const EgrantProjectIdSchema = z.string().trim().min(1).max(PROJECT_LIMITS.egrantId);

/** The intake's optional `project_id`: empty or missing means no project (decision 6a). */
export const EgrantProjectIdField = z
  .string()
  .trim()
  .max(PROJECT_LIMITS.egrantId)
  .transform((v) => (v === '' ? null : v))
  .nullish()
  .transform((v) => v ?? null);

export const EgrantProjectStateSchema = z.enum([
  'created',
  'unchanged',
  'pending',
  'stale',
  'stored',
]);
export type EgrantProjectState = z.infer<typeof EgrantProjectStateSchema>;

/** The answers of the project endpoint (201, 200, 202). */
export const EgrantProjectResponseSchema = z.object({
  project_id: z.string(),
  state: EgrantProjectStateSchema,
  pending: z.number().int().optional(),
  skipped: z.array(z.string()).optional(),
});
export type EgrantProjectResponse = z.infer<typeof EgrantProjectResponseSchema>;

export const EgrantChangeKindSchema = z.enum([
  'project_name',
  'project_description',
  'event_name',
  'event_date',
  'event_description',
  'event_add',
  'event_remove',
]);
export type EgrantChangeKind = z.infer<typeof EgrantChangeKindSchema>;

/** An incoming event of an `event_add` change. */
export const EgrantIncomingEventSchema = z.object({
  name: z.string(),
  occursOn: z.string(),
  description: z.string(),
});

/** One row of "Changes from eGrant" (`GET /api/projects/:id/egrant-changes`). */
export const EgrantChangeDtoSchema = z.object({
  id: z.string(),
  kind: EgrantChangeKindSchema,
  /** The event a field change or a removal is about; null for project fields and additions. */
  eventId: z.string().nullable(),
  /** The current value in Help (text, a `YYYY-MM-DD` date, or the event for a removal). */
  current: z.union([z.string(), EgrantIncomingEventSchema]).nullable(),
  /** The incoming value from eGrant (text, a date, or the whole event for an addition). */
  incoming: z.union([z.string(), EgrantIncomingEventSchema]).nullable(),
  sentAt: z.string(),
  receivedAt: z.string(),
});
export type EgrantChangeDto = z.infer<typeof EgrantChangeDtoSchema>;

export const EgrantChangeListSchema = z.object({
  changes: z.array(EgrantChangeDtoSchema),
  /** "Maybe the same event": an addition next to a removal (ids of both rows). */
  maybeSame: z.array(z.object({ addId: z.string(), removeId: z.string() })),
});
export type EgrantChangeList = z.infer<typeof EgrantChangeListSchema>;

/** `POST /api/projects/:id/egrant-changes`: rows left out stay pending. */
export const EgrantReviewBodySchema = z
  .object({
    accept: z.array(z.string().min(1).max(100)).max(500).default([]),
    dismiss: z.array(z.string().min(1).max(100)).max(500).default([]),
  })
  .refine((b) => b.accept.length + b.dismiss.length > 0, { message: 'nothing to review' })
  .refine((b) => !b.accept.some((id) => b.dismiss.includes(id)), {
    message: 'a change is either accepted or dismissed',
  });
export type EgrantReviewBody = z.output<typeof EgrantReviewBodySchema>;
