import { z } from 'zod';

/**
 * Saved views (F5, 2026-10-18): a person's named filter set on one of the admins' list pages
 * (`/finance` too, for finance admins),
 * kept as the page's URL (its path and filter params). A shared link is the URL itself.
 */
export const SavedViewPages = ['board', 'tickets', 'knowledge', 'finance'] as const;
export const SavedViewPageSchema = z.enum(SavedViewPages);
export type SavedViewPage = z.infer<typeof SavedViewPageSchema>;

/** The path each page's views open. */
export const SAVED_VIEW_PATHS: Readonly<Record<SavedViewPage, string>> = Object.freeze({
  board: '/tasks',
  tickets: '/tickets',
  knowledge: '/knowledge',
  finance: '/finance',
});

export const SAVED_VIEW_LIMITS = { name: 60, url: 1000, perPage: 30 } as const;

/**
 * Whether `url` is a view of `page`: its path, then a query string (`?…`) of filters; never
 * another path, host or a fragment (the web navigates to it as is).
 */
export function isSavedViewUrl(page: SavedViewPage, url: string): boolean {
  const path = SAVED_VIEW_PATHS[page];
  if (url.length > SAVED_VIEW_LIMITS.url || !url.startsWith(`${path}?`)) return false;
  const query = url.slice(path.length + 1);
  return query.length > 0 && !/[#\s\\]/.test(query);
}

export const SavedViewSchema = z.object({
  id: z.string(),
  page: SavedViewPageSchema,
  name: z.string(),
  url: z.string(),
  createdAt: z.string(),
});
export type SavedView = z.infer<typeof SavedViewSchema>;
export const SavedViewListSchema = z.array(SavedViewSchema);

export const SavedViewBodySchema = z
  .object({
    page: SavedViewPageSchema,
    name: z.string().trim().min(1).max(SAVED_VIEW_LIMITS.name),
    url: z.string().max(SAVED_VIEW_LIMITS.url),
  })
  .refine((b) => isSavedViewUrl(b.page, b.url), { message: 'not a view of this page' });
export type SavedViewBody = z.infer<typeof SavedViewBodySchema>;
