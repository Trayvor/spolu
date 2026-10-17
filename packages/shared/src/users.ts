import { z } from 'zod';

export const RoleSchema = z.enum(['superadmin', 'admin', 'client']);
export type Role = z.infer<typeof RoleSchema>;

export const SessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: RoleSchema,
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

/** A person's role in one group (Phase 21): `client` reads the group, `ziadatel` only their own tickets. */
export const MemberRoleSchema = z.enum(['client', 'ziadatel']);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

/** One of the signed-in person's active group memberships. */
export const MeGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: MemberRoleSchema,
  hasLogo: z.boolean(),
  /** Cache-buster for the logo URL (`?v=`). */
  updatedAt: z.string(),
});
export type MeGroup = z.infer<typeof MeGroupSchema>;

/**
 * What `/api/me` returns: the session user plus their active memberships, by group name (empty
 * for admins). A client may belong to several groups.
 */
export const MeSchema = SessionUserSchema.extend({ groups: z.array(MeGroupSchema) });
export type Me = z.infer<typeof MeSchema>;

export const AdminSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['superadmin', 'admin']),
});
export type Admin = z.infer<typeof AdminSchema>;

export const AdminListSchema = z.array(AdminSchema);

export const AddAdminBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1).max(100),
});
export type AddAdminBody = z.infer<typeof AddAdminBodySchema>;

export const ApiErrorBodySchema = z.object({ error: z.string() });
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/** Error codes in the `{ error }` body of our API routes. */
export const ErrorCodes = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  validationFailed: 'validation_failed',
  emailTakenAdmin: 'email_taken_admin',
  emailTakenClient: 'email_taken_client',
  invalidLogo: 'invalid_logo',
  egrantUrlTaken: 'egrant_url_taken',
  rateLimited: 'rate_limited',
  fileTooLarge: 'file_too_large',
  invalidAttachment: 'invalid_attachment',
  invalidPreview: 'invalid_preview',
  // Phase 8 — tasks
  fixedBucket: 'fixed_bucket',
  invalidAssignee: 'invalid_assignee',
  taskChanged: 'task_changed',
  // Phase 5 — chat
  invalidMention: 'invalid_mention',
  // Phase 6 — notifications and profile
  emailTaken: 'email_taken',
  pushUnavailable: 'push_unavailable',
  invalidSubscription: 'invalid_subscription',
  invalidCode: 'invalid_code',
  // Phase 9 — AI task split
  aiUnavailable: 'ai_unavailable',
  aiFailed: 'ai_failed',
  aiNoTasks: 'ai_no_tasks',
  // Phase 17 — knowledge base and reminders
  invalidUrl: 'invalid_url',
  invalidVisibility: 'invalid_visibility',
  knowledgeChanged: 'knowledge_changed',
  invalidReminder: 'invalid_reminder',
  reminderInPast: 'reminder_in_past',
  invalidRecipient: 'invalid_recipient',
  authorRecipient: 'author_recipient',
  noReminderSet: 'no_reminder_set',
  // Phase 20 — admin home and the global task board
  invalidFilter: 'invalid_filter',
  // Phase 21 — memberships
  removedMember: 'removed',
  // Phase 22b — member invites
  alreadyMember: 'already_member',
  // Phase 21 — tickets
  intakeDisabled: 'intake_disabled',
  hasTasks: 'has_tasks',
  noClient: 'no_client',
  // Phase 23 — bulk email
  changed: 'changed',
  notDraft: 'not_draft',
  notSending: 'not_sending',
  notReady: 'not_ready',
  emptyAudience: 'empty_audience',
  unsupportedType: 'unsupported_type',
  // Phase 24 — knowledge folders
  invalidFolder: 'invalid_folder',
  folderLimit: 'folder_limit',
  // Phase 30 — meetings
  invalidRecording: 'invalid_recording',
  recordingBusy: 'recording_busy',
  meetingBusy: 'meeting_busy',
  nothingToProcess: 'nothing_to_process',
  invalidTranscriptFile: 'invalid_transcript_file',
  // Phase 28 — knowledge items in chat
  invalidKnowledgeItem: 'invalid_knowledge_item',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
