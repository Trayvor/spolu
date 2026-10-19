/**
 * `/audit`'s filters in the URL (spec §4.3), validated by the lazy page itself (the route has no
 * `validateSearch`, so the entry chunk carries none of this). The server checks them again
 * (`AuditQuerySchema`); a bad value here is dropped, never sent.
 *
 * - `entityType`: one kind of record; `entityId` (one record) only with it.
 * - `group`: one client.
 * - `actor`: `user:<id>`, `token:<id>`, `kind:egrant`, `kind:system` or `kind:mcp`.
 * - `from`, `to`: `YYYY-MM-DD`, Bratislava days, inclusive.
 * - `label`: the chosen record's or author's label, for the chip (not a filter).
 */
export type AuditSearch = {
  entityType?: string;
  entityId?: string;
  group?: string;
  actor?: string;
  from?: string;
  to?: string;
  label?: string;
};

/** The filters remembered for the next visit; the one record is never remembered (spec §4.3). */
export const AUDIT_REMEMBERED_KEYS = ['entityType', 'group', 'actor', 'from', 'to'] as const;

/** What each key must look like; the server checks again (`AuditQuerySchema`). */
const SHAPES: Record<keyof AuditSearch, RegExp> = {
  entityType: /^[a-z_]{2,40}$/,
  entityId: /^.{1,200}$/,
  group: /^.{1,100}$/,
  actor: /^(user:.{1,100}|token:.{1,100}|kind:(egrant|system|mcp))$/,
  from: /^\d{4}-\d{2}-\d{2}$/,
  to: /^\d{4}-\d{2}-\d{2}$/,
  label: /^.{1,200}$/,
};

/** Every key is set (an invalid one to undefined), so a raw value never slips through. */
export function validateAuditSearch(search: Record<string, unknown>): AuditSearch {
  const out: AuditSearch = {};
  for (const key of Object.keys(SHAPES) as (keyof AuditSearch)[]) {
    // The router parses `?entityId=707` as a number: ids come back as text.
    const raw = search[key];
    const value = typeof raw === 'number' ? String(raw) : raw;
    out[key] = typeof value === 'string' && SHAPES[key].test(value) ? value : undefined;
  }
  if (!out.entityType) out.entityId = undefined;
  return out;
}
