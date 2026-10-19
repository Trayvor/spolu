import {
  AUDIT_FIELDS,
  AUDIT_LIMITS,
  type AuditChanges,
  type AuditEntityType,
  type AuditMoney,
  type AuditRef,
  type AuditScalar,
} from '@spolu/shared';

/** A field's value as a module hands it in; the field's kind (AUDIT_FIELDS) says how it is kept. */
export type FieldValue =
  string | number | boolean | null | undefined | Date | AuditRef | AuditRef[] | AuditMoney;

export type FieldValues = Partial<Record<string, FieldValue>>;

/** Cuts a string to `max` characters, the last one `…`. */
export function cut(value: string, max: number = AUDIT_LIMITS.valueChars): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function scalar(value: FieldValue): AuditScalar {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return cut(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function ref(value: FieldValue): AuditRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) {
    return null;
  }
  if (!('id' in value)) return null;
  return { id: value.id, label: cut(value.label, AUDIT_LIMITS.labelChars) };
}

function refs(value: FieldValue): AuditRef[] {
  if (!Array.isArray(value)) return [];
  return value.map((r) => ({ id: r.id, label: cut(r.label, AUDIT_LIMITS.labelChars) }));
}

function money(value: FieldValue): AuditMoney | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) {
    return null;
  }
  if (!('minor' in value)) return null;
  return { minor: value.minor, currency: value.currency };
}

const isEmpty = (v: FieldValue): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * The field-level diff of one record (spec §3.2), limited to the type's allowlist: `before` null
 * is a creation (the initial values as `to` only, empty ones left out), `after` null a deletion
 * (`from` only, never text). Unknown fields are ignored; a text field is `{ changed: true }` and
 * its text is never kept.
 */
export function diffFields(
  type: AuditEntityType,
  before: FieldValues | null,
  after: FieldValues | null,
): AuditChanges {
  const changes: AuditChanges = {};
  for (const [field, kind] of Object.entries(AUDIT_FIELDS[type])) {
    const hasBefore = before !== null && field in before;
    const hasAfter = after !== null && field in after;
    if (!hasBefore && !hasAfter) continue;
    const b = before?.[field];
    const a = after?.[field];
    if (before === null && isEmpty(a)) continue;
    if (after === null && (isEmpty(b) || kind === 'text')) continue;
    if (before !== null && after !== null && (!hasBefore || !hasAfter)) continue;
    switch (kind) {
      case 'text': {
        if (before === null || (b ?? '') !== (a ?? '')) changes[field] = { changed: true };
        break;
      }
      case 'value':
      case 'minutes': {
        const from = scalar(b);
        const to = scalar(a);
        if (before === null) changes[field] = { to };
        else if (after === null) changes[field] = { from };
        else if (from !== to) changes[field] = { from, to };
        break;
      }
      case 'ref': {
        const from = ref(b);
        const to = ref(a);
        if (before === null) changes[field] = { to };
        else if (after === null) changes[field] = { from };
        else if ((from?.id ?? null) !== (to?.id ?? null)) changes[field] = { from, to };
        break;
      }
      case 'money': {
        const from = money(b);
        const to = money(a);
        if (before === null) changes[field] = { to };
        else if (after === null) changes[field] = { from };
        else if (from?.minor !== to?.minor || from?.currency !== to?.currency) {
          changes[field] = { from, to };
        }
        break;
      }
      case 'refs': {
        const from = refs(b);
        const to = refs(a);
        const fromIds = new Set(from.map((r) => r.id));
        const toIds = new Set(to.map((r) => r.id));
        const added = to.filter((r) => !fromIds.has(r.id)).slice(0, AUDIT_LIMITS.refsMax);
        const removed = from.filter((r) => !toIds.has(r.id)).slice(0, AUDIT_LIMITS.refsMax);
        if (after === null) {
          if (removed.length > 0) changes[field] = { added: [], removed };
        } else if (added.length > 0 || removed.length > 0) changes[field] = { added, removed };
        break;
      }
    }
  }
  return changes;
}

/** Whether a diff holds at least one change (`_truncated` and `_batch` count too). */
export function hasChanges(changes: AuditChanges): boolean {
  return Object.keys(changes).length > 0;
}
