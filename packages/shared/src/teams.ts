import { z } from 'zod';

// Microsoft Teams integration, T1: the Teams side of a knowledge meeting ("call") item. The
// user-facing object stays the knowledge meeting; these are the admins' Teams block and the
// public add-to-calendar page.

export const TEAMS_LIMITS = {
  /** People invited when Help creates the meeting. */
  attendees: 100,
  minMinutes: 15,
  maxMinutes: 8 * 60,
  defaultMinutes: 60,
  /** Characters of a pasted Teams link. */
  link: 2000,
} as const;

/**
 * Where the transcript import stands: `waiting` (polling), `imported` (on the record),
 * `available` (Teams has one, the record kept its own transcript), `none` (polling ended, no
 * transcript), `failed` (polling ended on an error).
 */
export const TeamsTranscriptStates = [
  'waiting',
  'imported',
  'available',
  'none',
  'failed',
] as const;
export type TeamsTranscriptState = (typeof TeamsTranscriptStates)[number];

export const TeamsLinkSchema = z.object({
  /** `help`: created from Help; `linked`: a pasted link of a meeting made in Teams or Outlook. */
  origin: z.enum(['help', 'linked']),
  joinUrl: z.string(),
  organizerName: z.string().nullable(),
  durationMinutes: z.number().int(),
  recordAutomatically: z.boolean(),
  transcriptState: z.enum(TeamsTranscriptStates),
  /** The last Graph error code (e.g. `GraphAccessToTranscriptsDisabled`), for the admins. */
  lastError: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  /** When the next automatic check runs; null when polling is over. */
  nextCheckAt: z.string().nullable(),
  /** The public add-to-calendar page (`/m/<token>`); Help-made meetings only. */
  invitationUrl: z.string().nullable(),
});
export type TeamsLink = z.infer<typeof TeamsLinkSchema>;

/** `GET /api/knowledge/:id/teams` (admins only; 404 when Teams is not configured). */
export const TeamsMeetingStateSchema = z.object({
  link: TeamsLinkSchema.nullable(),
});
export type TeamsMeetingState = z.infer<typeof TeamsMeetingStateSchema>;

/** One person the create dialog offers to invite: the group's clients and managers. */
export const TeamsInviteeOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  isAdmin: z.boolean(),
});
export type TeamsInviteeOption = z.infer<typeof TeamsInviteeOptionSchema>;
export const TeamsInviteeOptionListSchema = z.array(TeamsInviteeOptionSchema);

const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));

/** `POST /api/knowledge/:id/teams/meeting`. Nobody is invited unless picked. */
export const TeamsCreateBodySchema = z
  .object({
    durationMinutes: z
      .number()
      .int()
      .min(TEAMS_LIMITS.minMinutes)
      .max(TEAMS_LIMITS.maxMinutes)
      .default(TEAMS_LIMITS.defaultMinutes),
    attendees: z
      .array(z.object({ email, name: z.string().trim().max(200).optional() }))
      .max(TEAMS_LIMITS.attendees)
      .default([]),
    /** "Record and transcribe automatically" (owner answer 2: default on). */
    recordAutomatically: z.boolean().default(true),
  })
  .strict();
export type TeamsCreateBody = z.output<typeof TeamsCreateBodySchema>;

/** `POST /api/knowledge/:id/teams/connect`: a pasted Teams join link. */
export const TeamsConnectBodySchema = z
  .object({ url: z.string().trim().min(1).max(TEAMS_LIMITS.link) })
  .strict();
export type TeamsConnectBody = z.infer<typeof TeamsConnectBodySchema>;

/** `POST /api/knowledge/:id/teams/check`: "Check now", or "Replace with the Teams transcript". */
export const TeamsCheckBodySchema = z.object({ replace: z.boolean().default(false) }).strict();
export type TeamsCheckBody = z.output<typeof TeamsCheckBodySchema>;

/**
 * `GET /api/public/meetings/:token`: everything the public page shows, nothing else (the owner
 * accepted the title, the time and the join link).
 */
export const PublicMeetingSchema = z.object({
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  joinUrl: z.string(),
  /** Help switched on automatic recording and transcription: the page shows the notice. */
  recorded: z.boolean(),
});
export type PublicMeeting = z.infer<typeof PublicMeetingSchema>;
