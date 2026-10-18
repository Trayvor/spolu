import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { FINANCE_LIMITS, formatMoney, parseMoney, type Currency } from '@spolu/shared';
import { CloseIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** One share row of the form: the client and the amount as typed. */
export type ShareRow = { key: string; groupId: string; amount: string };

let seq = 0;
export const newShareRow = (groupId = ''): ShareRow => {
  seq += 1;
  return { key: `share-${seq}`, groupId, amount: '' };
};

/** How far the typed shares are from the contract's amount (minor units); null: not readable. */
export function sharesBalance(
  totalText: string,
  rows: readonly ShareRow[],
  currency: Currency,
): { total: number; allocated: number } | null {
  const total = parseMoney(totalText, currency);
  if (!total) return null;
  let allocated = 0;
  for (const row of rows) {
    if (row.amount.trim() === '') continue;
    const money = parseMoney(row.amount, currency);
    if (!money) return null;
    allocated += money.amountMinor;
  }
  return { total: total.amountMinor, allocated };
}

/**
 * The amount split evenly over the rows in whole cents; the first rows take the remaining cents,
 * so the shares always add up exactly (decision O1).
 */
export function splitEvenly(totalMinor: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalMinor / count);
  const extra = totalMinor - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * The shares of a contract of several clients (Phase 32 E, decisions O1, E8): a row per client
 * with its part of the amount, and under them the reconciliation line that says, in the
 * contract's currency, how much is still to split, how much too much, or that it adds up. The
 * only thing the line colours is the state: attention while unbalanced, success when exact.
 */
export function SharesField({
  rows,
  onChange,
  clients,
  totalText,
  currency,
  language,
  error,
  toText,
}: {
  rows: ShareRow[];
  onChange: (rows: ShareRow[]) => void;
  clients: readonly { id: string; name: string }[];
  /** The contract's amount as typed. */
  totalText: string;
  currency: Currency;
  language: string;
  error?: string;
  /** Minor units as the amount field shows them (the form's `amountText`). */
  toText: (amountMinor: number) => string;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`financeOrg.shares.${key}`, options);
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency }, language);
  const balance = sharesBalance(totalText, rows, currency);
  const left = balance ? balance.total - balance.allocated : null;
  const set = (key: string, patch: Partial<ShareRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const nameOf = (id: string) => clients.find((c) => c.id === id)?.name ?? '';
  const split = () => {
    const total = parseMoney(totalText, currency);
    if (!total || rows.length === 0) return;
    const parts = splitEvenly(total.amountMinor, rows.length);
    onChange(rows.map((row, i) => ({ ...row, amount: toText(parts[i]!) })));
  };

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={`${uid}-status`}>
      <legend className="mb-1 text-button font-semibold">{k('title')}</legend>
      <ul role="list" className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const taken = new Set(rows.filter((r) => r.key !== row.key).map((r) => r.groupId));
          return (
            <li
              key={row.key}
              className="grid grid-cols-[1fr_auto] items-center gap-2 min-[641px]:grid-cols-[1fr_11rem_auto]"
            >
              <Select
                aria-label={k('client', { n: index + 1 })}
                value={row.groupId}
                onChange={(event) => set(row.key, { groupId: event.target.value })}
                containerClassName="col-span-2 min-w-0 min-[641px]:col-span-1"
                className="py-2"
                data-testid="share-client"
              >
                <option value="">{k('chooseClient')}</option>
                {clients
                  .filter((c) => c.id === row.groupId || !taken.has(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
              <div className="flex items-center gap-2">
                <Input
                  aria-label={k('amount', { name: nameOf(row.groupId) || index + 1 })}
                  inputMode="decimal"
                  autoComplete="off"
                  value={row.amount}
                  onChange={(event) => set(row.key, { amount: event.target.value })}
                  className="min-w-0 flex-1 py-2 text-right tabular-nums"
                  data-testid="share-amount"
                />
                <span className="text-tiny font-semibold text-muted-foreground">{currency}</span>
              </div>
              <button
                type="button"
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                aria-label={k('remove', { name: nameOf(row.groupId) || index + 1 })}
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <CloseIcon />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={rows.length >= FINANCE_LIMITS.maxShares}
          onClick={() => onChange([...rows, newShareRow()])}
        >
          <span aria-hidden="true">+</span>
          {k('add')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={rows.length < 2 || !parseMoney(totalText, currency)}
          onClick={split}
        >
          {k('split')}
        </Button>
      </div>
      <p
        id={`${uid}-status`}
        aria-live="polite"
        data-testid="shares-status"
        className={cn(
          'rounded-lg px-3 py-2 text-button tabular-nums',
          left === 0 ? 'bg-success/10 text-success' : 'bg-secondary text-foreground',
          left !== null && left < 0 && 'text-error-ink',
        )}
      >
        {balance === null || left === null
          ? k('unknown')
          : left === 0
            ? k('balanced', { total: money(balance.total) })
            : left > 0
              ? k('left', { amount: money(left), total: money(balance.total) })
              : k('over', { amount: money(-left) })}
      </p>
      {error && <p className="text-tiny text-error-ink">{error}</p>}
    </fieldset>
  );
}
