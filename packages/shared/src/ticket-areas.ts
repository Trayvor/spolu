import { z } from 'zod';
import { IdSchema } from './chat.js';

/**
 * Automatic riešitelia by question area (2026-10-21, "Automatické priraďovanie riešiteľov"): per
 * client, a table of area → admin. A new ticket of that client whose area matches a row gets the
 * row's admin as a riešiteľ. Edited in the client's Tickets tab (admins), by MCP, and replaced
 * whole by eGrant (`PUT /api/egrant/ticket-areas`). See docs/product/tickets.md.
 */

export const TICKET_AREA_LIMITS = {
  /** Rows of one client's table (the web, MCP and eGrant). */
  rows: 200,
  /** Characters of an area name, as a ticket's `area` (`TICKET_LIMITS.area`). */
  area: 200,
  email: 254,
  /** The eGrant call's body: 200 rows of 200 + 254 characters fit with room to spare. */
  bodyBytes: 256 * 1024,
} as const;

/** Letters that NFD does not split into a base letter and a mark. */
const PLAIN_LETTERS: Record<string, string> = { đ: 'd', ł: 'l', ø: 'o', ß: 'ss', æ: 'ae' };

/**
 * eGrant names some areas with a technical prefix: `zend.Projekty`, `zend Projekty` or
 * `zendProjekty` all mean `Projekty`. Only a lower-case `zend` followed by a dot, whitespace or an
 * upper-case letter is a prefix, and only when something follows it (`zend` alone stays).
 */
const ZEND_PREFIX = /^zend(?:\.\s*|\s+|(?=\p{Lu}))/u;

/**
 * The key two areas are compared by: the `zend` prefix dropped (on the trimmed text), then
 * diacritics folded (NFD, combining marks removed, đ ł ø ß æ spelled out), lower-cased, and every
 * run of whitespace one space, trimmed. `"  zend.Žiadosti  o  PLATBU "` → `"ziadosti o platbu"`.
 * The same function keys a ticket's area and a table row, so the rule holds on both sides.
 */
export function ticketAreaKey(area: string): string {
  let text = area.trim();
  const prefix = ZEND_PREFIX.exec(text);
  if (prefix && text.length > prefix[0].length) text = text.slice(prefix[0].length);
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[đłøßæ]/g, (c) => PLAIN_LETTERS[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim();
}

/** An area as written in a row: trimmed, 1–200 characters, and not empty once keyed. */
const areaName = z
  .string()
  .trim()
  .min(1)
  .max(TICKET_AREA_LIMITS.area)
  .refine((a) => ticketAreaKey(a).length > 0, { message: 'empty area' });

/** One row as the web and MCP send it: the area and the admin's user id. */
export const TicketAreaRuleInputSchema = z.object({ area: areaName, userId: IdSchema });
export type TicketAreaRuleInput = z.infer<typeof TicketAreaRuleInputSchema>;

/** `PUT /api/groups/:id/ticket-areas`: the whole table, in order (it replaces the stored one). */
export const TicketAreaRulesBodySchema = z.object({
  rules: z.array(TicketAreaRuleInputSchema).max(TICKET_AREA_LIMITS.rows),
});
export type TicketAreaRulesBody = z.infer<typeof TicketAreaRulesBodySchema>;

/** One stored row: the area as written, and its admin. */
export const TicketAreaRuleSchema = z.object({
  area: z.string(),
  user: z.object({ id: z.string(), name: z.string() }),
});
export type TicketAreaRule = z.infer<typeof TicketAreaRuleSchema>;

/** `GET` and `PUT /api/groups/:id/ticket-areas`. */
export const TicketAreaRulesSchema = z.object({ rules: z.array(TicketAreaRuleSchema) });
export type TicketAreaRules = z.infer<typeof TicketAreaRulesSchema>;

/**
 * `PUT /api/egrant/ticket-areas`: one instance's full list of area → admin email. It replaces the
 * client's whole table; an email of no active admin is skipped and answered in `unmatched`.
 */
export const EgrantTicketAreasBodySchema = z.object({
  instance_url: z.string().trim().min(1).max(2048),
  areas: z
    .array(
      z.object({
        area: areaName,
        email: z.string().trim().toLowerCase().min(3).max(TICKET_AREA_LIMITS.email).pipe(z.email()),
      }),
    )
    .max(TICKET_AREA_LIMITS.rows),
});
export type EgrantTicketAreasBody = z.infer<typeof EgrantTicketAreasBodySchema>;

/**
 * The answer: `updated` when the table changed, `unchanged` when it already was this list (a
 * resend); `rules` the stored rows, `unmatched` the sent rows whose email is no active admin.
 */
export const EgrantTicketAreasResponseSchema = z.object({
  state: z.enum(['updated', 'unchanged']),
  group_id: z.string(),
  rules: z.array(z.object({ area: z.string(), email: z.string() })),
  unmatched: z.array(z.object({ area: z.string(), email: z.string() })),
});
export type EgrantTicketAreasResponse = z.infer<typeof EgrantTicketAreasResponseSchema>;
