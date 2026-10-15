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
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
