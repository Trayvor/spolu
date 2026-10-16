import { z } from 'zod';

const groupName = z.string().trim().min(1).max(100);

export const GroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  hasLogo: z.boolean(),
  memberCount: z.number().int(),
  /** Cache-buster for the logo URL (`?v=`). */
  updatedAt: z.string(),
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

export const GroupPersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  isAdmin: z.boolean(),
  /** An admin who manages this group. Always false for clients. */
  isManager: z.boolean(),
});
export type GroupPerson = z.infer<typeof GroupPersonSchema>;
/** Who can be assigned or picked: the group's clients and its managers, not every admin. */
export const isPickable = (person: GroupPerson): boolean => !person.isAdmin || person.isManager;
export const GroupPersonListSchema = z.array(GroupPersonSchema);

/** An active admin who manages a group. */
export const GroupManagerSchema = z.object({ id: z.string(), name: z.string() });
export type GroupManager = z.infer<typeof GroupManagerSchema>;

export const JoinInfoSchema = z.object({
  name: z.string(),
  hasLogo: z.boolean(),
  /** ISO time of the last group change; the join page appends it to the logo URL as a cache key. */
  updatedAt: z.string(),
});
export type JoinInfo = z.infer<typeof JoinInfoSchema>;

export const JoinBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});
export type JoinBody = z.infer<typeof JoinBodySchema>;

export const NameBodySchema = z.object({ name: groupName });
export type NameBody = z.infer<typeof NameBodySchema>;
