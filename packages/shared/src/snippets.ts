import { z } from 'zod';

/**
 * Canned replies (F7, 2026-10-18): an admin's own snippets and the team's shared ones, inserted
 * with `/` in a chat or ticket composer. `{{name}}` becomes the name of the person answered.
 */
export const SNIPPET_LIMITS = { title: 80, body: 4000, perUser: 200 } as const;

export const SnippetSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  /** Every admin sees and inserts a shared snippet; only its author changes it. */
  shared: z.boolean(),
  /** The caller wrote it (and may change or delete it). */
  mine: z.boolean(),
  authorName: z.string(),
  updatedAt: z.string(),
});
export type Snippet = z.infer<typeof SnippetSchema>;
export const SnippetListSchema = z.array(SnippetSchema);

export const SnippetBodySchema = z.object({
  title: z.string().trim().min(1).max(SNIPPET_LIMITS.title),
  body: z.string().trim().min(1).max(SNIPPET_LIMITS.body),
  shared: z.boolean().default(false),
});
export type SnippetBody = z.infer<typeof SnippetBodySchema>;

export const SnippetPatchSchema = z
  .object({
    title: SnippetBodySchema.shape.title,
    body: SnippetBodySchema.shape.body,
    shared: z.boolean(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'nothing to change' });
export type SnippetPatch = z.infer<typeof SnippetPatchSchema>;

const NAME_RE = /\{\{\s*name\s*\}\}/g;

/**
 * The snippet's text for one reply: `{{name}}` (spaces allowed inside the braces) becomes `name`;
 * without a name the placeholder stays, for the admin to fill in.
 */
export function fillSnippet(body: string, name: string | null | undefined): string {
  const value = name?.trim();
  return value ? body.replace(NAME_RE, value) : body;
}
