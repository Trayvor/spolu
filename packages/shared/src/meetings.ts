import { z } from 'zod';
import { FileInfoSchema } from './files.js';
import { isHttpUrl } from './urls.js';

// Phase 30 — the knowledge type "meeting": its fields, its recording and AI states, its summary.

export const MEETING_LIMITS = {
  /** Characters of a transcript (pasted, extracted from a file or made by the AI). */
  transcript: 400_000,
  /** Characters of the transcript the summary AI gets. */
  summaryInput: 300_000,
  /** Characters of the summary paragraph. */
  summary: 2000,
  /** Entries of each summary list (decisions, action items, open questions). */
  listItems: 30,
  /** Characters of one list entry. */
  listItem: 500,
  /** Characters of a suggested assignee name. */
  assignee: 200,
  /** Bytes of an uploaded recording (audio or video). */
  recordingBytes: 2 * 1024 * 1024 * 1024,
  /** Bytes of a transcript file (.txt, .vtt, .srt, .docx). */
  transcriptFileBytes: 10 * 1024 * 1024,
} as const;

/** The stored compact audio: none, being transcoded, ready to play, or the transcode failed. */
export const MeetingRecordingStates = ['none', 'processing', 'ready', 'failed'] as const;
export type MeetingRecordingState = (typeof MeetingRecordingStates)[number];

/** The AI run of a meeting ("Spracovať s AI"). */
export const MeetingAiStates = [
  'idle',
  'queued',
  'transcribing',
  'summarizing',
  'done',
  'failed',
] as const;
export type MeetingAiState = (typeof MeetingAiStates)[number];

/** A run that is queued or running: a second one is refused (409 `meeting_busy`). */
export const isMeetingAiBusy = (state: MeetingAiState): boolean =>
  state === 'queued' || state === 'transcribing' || state === 'summarizing';

/** Why a run failed. */
export const MeetingAiErrors = ['transcription_failed', 'summary_failed'] as const;
export type MeetingAiError = (typeof MeetingAiErrors)[number];

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalUrl = z.string().trim().refine(isHttpUrl).nullable();
const transcriptField = z.string().max(MEETING_LIMITS.transcript);
const listEntry = z.string().trim().min(1).max(MEETING_LIMITS.listItem);

export const MeetingActionItemSchema = z.object({
  text: listEntry,
  /** A name the meeting gave for who does it; null when nobody was named. */
  assignee: z.string().trim().max(MEETING_LIMITS.assignee).nullable(),
  /** YYYY-MM-DD when a deadline was said. */
  deadline: isoDate.nullable(),
});
export type MeetingActionItem = z.infer<typeof MeetingActionItemSchema>;

/** The structured summary, made by the AI and editable by the item's editors. */
export const MeetingSummarySchema = z.object({
  summary: z.string().trim().max(MEETING_LIMITS.summary),
  decisions: z.array(listEntry).max(MEETING_LIMITS.listItems),
  actionItems: z.array(MeetingActionItemSchema).max(MEETING_LIMITS.listItems),
  openQuestions: z.array(listEntry).max(MEETING_LIMITS.listItems),
  /** The transcript's language (ISO 639-1), as the AI saw it; informational. */
  language: z.string().max(10).nullable(),
});
export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;

/** A new meeting's own fields; the links are optional. */
export const MeetingInputSchema = z.object({
  startsAt: isoDateTime,
  meetingUrl: optionalUrl.default(null),
  recordingUrl: optionalUrl.default(null),
  transcriptUrl: optionalUrl.default(null),
  transcript: transcriptField.default(''),
});
export type MeetingInput = z.output<typeof MeetingInputSchema>;

/** An edit of a meeting's fields: an omitted field stays; `summary` null removes it. */
export const MeetingPatchSchema = z
  .object({
    startsAt: isoDateTime.optional(),
    meetingUrl: optionalUrl.optional(),
    recordingUrl: optionalUrl.optional(),
    transcriptUrl: optionalUrl.optional(),
    transcript: transcriptField.optional(),
    summary: MeetingSummarySchema.nullable().optional(),
  })
  .strict();
export type MeetingPatch = z.output<typeof MeetingPatchSchema>;

/** What a list row shows of a meeting. */
export const MeetingListInfoSchema = z.object({
  startsAt: z.string(),
  recording: z.enum(MeetingRecordingStates),
  ai: z.enum(MeetingAiStates),
  hasSummary: z.boolean(),
});
export type MeetingListInfo = z.infer<typeof MeetingListInfoSchema>;

/** The detail of a meeting. */
export const MeetingDetailSchema = z.object({
  startsAt: z.string(),
  meetingUrl: z.string().nullable(),
  recordingUrl: z.string().nullable(),
  transcriptUrl: z.string().nullable(),
  transcript: z.string(),
  /** `ai` when the AI made the transcript; `manual` when someone typed, pasted or uploaded it. */
  transcriptSource: z.enum(['manual', 'ai']).nullable(),
  recording: z.object({
    state: z.enum(MeetingRecordingStates),
    /** The stored compact audio (`GET /api/files/:id` plays it). */
    file: FileInfoSchema.nullable(),
  }),
  ai: z.object({
    state: z.enum(MeetingAiStates),
    error: z.enum(MeetingAiErrors).nullable(),
    updatedAt: z.string().nullable(),
  }),
  summary: MeetingSummarySchema.nullable(),
  /** The viewer may press "Spracovať s AI" (an admin, and the server has the AI it needs). */
  canProcess: z.boolean(),
});
export type MeetingDetail = z.infer<typeof MeetingDetailSchema>;

/** `POST /api/knowledge/transcript-text`: the text of an uploaded transcript file. */
export const TranscriptTextSchema = z.object({ text: z.string() });
export type TranscriptText = z.infer<typeof TranscriptTextSchema>;

/** One meeting on the dashboard's Meetings card. */
export const HomeMeetingSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  title: z.string(),
  startsAt: z.string(),
  hasSummary: z.boolean(),
});
export type HomeMeeting = z.infer<typeof HomeMeetingSchema>;

/** `GET /api/me/home/meetings`. */
export const HomeMeetingsSchema = z.object({
  /** Meetings in the next 7 days (the card's count). */
  upcomingTotal: z.number().int(),
  upcoming: z.array(HomeMeetingSchema),
  /** Past meetings of the last 30 days without a summary. */
  unsummarizedTotal: z.number().int(),
  unsummarized: z.array(HomeMeetingSchema),
});
export type HomeMeetings = z.infer<typeof HomeMeetingsSchema>;

export const HOME_MEETING_LIMITS = { items: 10, aheadDays: 7, pastDays: 30 } as const;
