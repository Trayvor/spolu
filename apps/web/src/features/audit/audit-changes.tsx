import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencySchema, formatMoney, type AuditEntityType } from '@spolu/shared';
import { formatScalar } from './format';

type Ref = { id: string; label: string };
type MoneyValue = { minor: number; currency: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isRef = (v: unknown): v is Ref => isObject(v) && typeof v.id === 'string';
const isMoney = (v: unknown): v is MoneyValue => isObject(v) && typeof v.minor === 'number';

/** One field's change as the log stored it (spec §3.2), or null for a marker such as `_batch`. */
export type ChangeLine = { field: string; change: Record<string, unknown> };

/** The field lines of a row, in the stored order, without the `_batch` / `_truncated` markers. */
export function changeLines(changes: Record<string, unknown>): ChangeLine[] {
  return Object.entries(changes).flatMap(([field, change]) =>
    field.startsWith('_') || !isObject(change) ? [] : [{ field, change }],
  );
}

/**
 * The lines of a row's changes: `Field: old → new` (the old value struck through), text fields
 * as "zmenený" and never a value, people and files as "+ name" / "− name", money in the
 * viewer's language. Values are text (React escapes them); nothing is rendered as HTML.
 */
export function AuditChanges({ type, lines }: { type: AuditEntityType; lines: ChangeLine[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const fieldLabel = (field: string) => t(`audit.fields.${type}.${field}`, { defaultValue: field });

  const value = (field: string, v: unknown): ReactNode => {
    if (v === null || v === undefined || v === '') return t('audit.row.empty');
    if (isMoney(v)) {
      const currency = CurrencySchema.safeParse(v.currency);
      return currency.success
        ? formatMoney({ amountMinor: v.minor, currency: currency.data }, lang)
        : `${v.minor} ${v.currency}`;
    }
    if (isRef(v)) {
      return field === 'bucket'
        ? t(`audit.values.bucket.${v.label}`, { defaultValue: v.label })
        : v.label;
    }
    if (typeof v === 'boolean') return v ? t('audit.row.yes') : t('audit.row.no');
    if (typeof v === 'number') {
      return field === 'minutes' ? t('audit.row.minutes', { count: v }) : String(v);
    }
    if (typeof v === 'string') {
      const known = ['visibility', 'status', 'role', 'scope'].includes(field)
        ? t(`audit.values.${field}.${v}`, { defaultValue: '' })
        : '';
      return known || formatScalar(v, lang);
    }
    return null;
  };

  return (
    <ul className="flex flex-col gap-1 text-tiny text-muted-foreground">
      {lines.map(({ field, change }) => (
        <li key={field} className="min-w-0 break-words">
          <span className="font-medium text-foreground">{fieldLabel(field)}:</span>{' '}
          {'changed' in change ? (
            t('audit.row.textChanged')
          ) : 'added' in change || 'removed' in change ? (
            <RefsChange
              added={(change.added as Ref[] | undefined) ?? []}
              removed={(change.removed as Ref[] | undefined) ?? []}
            />
          ) : (
            <span>
              {'from' in change && (
                <>
                  <del className="decoration-muted-foreground/60">{value(field, change.from)}</del>
                  {'to' in change && ' → '}
                </>
              )}
              {'to' in change && (
                <ins className="text-foreground no-underline">{value(field, change.to)}</ins>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function RefsChange({ added, removed }: { added: Ref[]; removed: Ref[] }) {
  return (
    <span>
      {[...added.map((r) => ({ ...r, sign: '+' })), ...removed.map((r) => ({ ...r, sign: '−' }))]
        .map((r) => `${r.sign} ${r.label}`)
        .join(', ')}
    </span>
  );
}
