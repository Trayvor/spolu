import { z } from 'zod';

const groupName = z.string().trim().min(1).max(100);

export const GroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  hasLogo: z.boolean(),
  memberCount: z.number().int(),
});
export type GroupSummary = z.infer<typeof GroupSummarySchema>;
export const GroupSummaryListSchema = z.array(GroupSummarySchema);

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  egrantUrl: z.string(),
  hasLogo: z.boolean(),
  updatedAt: z.string(),
  /** Admins only. */
  inviteUrl: z.string().optional(),
});
export type Group = z.infer<typeof GroupSchema>;

export const GroupInputSchema = z.object({ name: groupName, egrantUrl: z.string().max(2048) });
export type GroupInput = z.infer<typeof GroupInputSchema>;

export const MemberSchema = z.object({ id: z.string(), name: z.string(), email: z.string() });
export type Member = z.infer<typeof MemberSchema>;
export const MemberListSchema = z.array(MemberSchema);

export const JoinInfoSchema = z.object({ name: z.string(), hasLogo: z.boolean() });
export type JoinInfo = z.infer<typeof JoinInfoSchema>;

export const JoinBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});
export type JoinBody = z.infer<typeof JoinBodySchema>;

export const NameBodySchema = z.object({ name: groupName });
export type NameBody = z.infer<typeof NameBodySchema>;
