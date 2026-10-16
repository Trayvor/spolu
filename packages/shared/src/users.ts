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

/** What `/api/me` returns: the session user plus the client's group (null for admins). */
export const MeSchema = SessionUserSchema.extend({ groupId: z.string().nullable() });
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
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
