import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import {
  formatMoney,
  type ContractRef,
  type FinanceItemDetail,
  type PeriodStatus,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUpdateSearch } from '@/lib/use-update-search';
import type { FinanceOwner } from './api';
import { scheduleSummaryKey } from './contract-form';
import { formatDay, formatPeriod } from './format';

/**
 * Contracts v2 (ADR 0066) in an item's view: a contract's master and the contracts under it, its
 * payment schedule with the expected payments (each period paid, partly paid, unpaid or still
 * expected, from the payments of the linked documents) and those documents; a document's
 * contract and the payment it records. Texts in `financeDocuments.contracts`.
 */

/** Opens another finance item: here (`?item=`), or a client's item in its client's tab. */
function ItemLink({
  owner,
  target,
  children,
}: {
  owner: FinanceOwner;
  target: { id: string; groupId: string | null };
  children: ReactNode;
}) {
  const updateSearch = useUpdateSearch();
  if (owner.kind === 'org' && target.groupId !== null) {
    return (
      <Link
        to="/groups/$groupId/finance"
        params={{ groupId: target.groupId }}
        search={{ item: target.id }}
        className="font-medium hover:underline"
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="text-left font-medium hover:underline"
      onClick={() => updateSearch((s) => void (s.item = target.id), { replace: false })}
    >
      {children}
    </button>
  );
}

const refTitle = (c: ContractRef) =>
  c.contractNumber ? `${c.contractNumber} · ${c.title}` : c.title;

/** The mark of a period's status: a filled, half or empty square, never colour alone. */
export function StatusMark({ status, label }: { status: PeriodStatus; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-block size-3 shrink-0 rounded-[3px] border-2',
        status === 'paid' && 'border-success bg-success',
        status === 'partial' &&
          'border-attention bg-[linear-gradient(135deg,var(--color-attention)_50%,transparent_50%)]',
        status === 'unpaid' && 'border-error-ink bg-transparent',
        status === 'upcoming' && 'border-dashed border-muted-foreground bg-transparent',
      )}
    />
  );
}

/** "+600 € every month". */
export function useScheduleLine() {
  const { t, i18n } = useTranslation();
  return (s: {
    frequency: Parameters<typeof scheduleSummaryKey>[0]['frequency'];
    everyMonths: number | null;
    dates?: readonly string[] | null;
    amount: { amountMinor: number; currency: 'EUR' | 'UAH' };
  }) => {
    const { key, count } = scheduleSummaryKey(s);
    return t(`financeDocuments.contracts.every.${key}`, {
      amount: formatMoney(s.amount, i18n.language),
      n: count,
    });
  };
}

/** How many periods the view lists before "Show all". */
const SHOWN_PERIODS = 6;

export function ContractSections({
  item,
  owner,
  language,
}: {
  item: FinanceItemDetail;
  owner: FinanceOwner;
  language: string;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`financeDocuments.contracts.${key}`, options);
  const line = useScheduleLine();
  const [all, setAll] = useState(false);
  const money = (m: { amountMinor: number; currency: 'EUR' | 'UAH' }) => formatMoney(m, language);

  if (item.type === 'document') {
    const link = item.contractLink;
    if (!link) return null;
    return (
      <section className="flex flex-col gap-2" data-testid="document-contract">
        <h3 className="text-button font-semibold">{k('linkedTo')}</h3>
        <div className="flex flex-col gap-1 rounded-lg bg-muted p-4 text-button">
          <ItemLink owner={owner} target={link.contract}>
            {refTitle(link.contract)}
          </ItemLink>
          <span className="text-tiny text-muted-foreground tabular-nums">
            {formatPeriod(link.contract.startsOn, link.contract.endsOn, language)}
          </span>
          {link.payment && (
            <span className="tabular-nums">
              {k('paymentOn', {
                amount: money(link.payment.amount),
                date: formatDay(link.payment.paidOn, language),
              })}
            </span>
          )}
        </div>
      </section>
    );
  }
  if (item.type !== 'contract') return null;
  const periods = item.payments?.periods ?? [];
  // The latest due periods and the next ones around today first; "Show all" lists every one.
  const firstComing = periods.findIndex((p) => p.status === 'upcoming');
  const end = firstComing < 0 ? periods.length : Math.min(periods.length, firstComing + 2);
  const shown = all ? periods : periods.slice(Math.max(0, end - SHOWN_PERIODS), end);
  return (
    <>
      {item.parent && (
        <section className="flex flex-col gap-1" data-testid="contract-master">
          <h3 className="text-button font-semibold">{k('master')}</h3>
          <p className="text-button">
            <ItemLink owner={owner} target={item.parent}>
              {refTitle(item.parent)}
            </ItemLink>
          </p>
        </section>
      )}
      {item.children && item.children.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="contract-children">
          <h3 className="text-button font-semibold">{k('children')}</h3>
          <ul className="flex flex-col">
            {item.children.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border py-2 text-button last:border-b-0"
              >
                <ItemLink owner={owner} target={c}>
                  {refTitle(c)}
                </ItemLink>
                <span className="text-tiny text-muted-foreground tabular-nums">
                  {formatPeriod(c.startsOn, c.endsOn, language)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {item.schedule && item.payments && (
        <section className="flex flex-col gap-3" data-testid="contract-schedule">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className="text-button font-semibold">{k('expected')}</h3>
            <span className="text-button font-semibold tabular-nums">
              {line({ ...item.schedule, amount: periods[0]?.expected ?? item.schedule.amount })}
            </span>
          </div>
          <dl className="grid grid-cols-3 gap-3 rounded-lg bg-muted p-4">
            {(
              [
                ['dueToDate', item.payments.dueToDate],
                ['received', item.payments.received],
                ['stillExpected', item.payments.upcoming],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-micro text-muted-foreground">{k(key)}</dt>
                <dd className="text-button font-semibold tabular-nums">{money(value)}</dd>
              </div>
            ))}
          </dl>
          {item.payments.nextDueOn && (
            <p className="text-tiny text-muted-foreground">
              {k('nextDue', { date: formatDay(item.payments.nextDueOn, language) })}
            </p>
          )}
          <table className="w-full text-button">
            <caption className="sr-only">{k('expected')}</caption>
            <tbody>
              {shown.map((p) => {
                const status = k(`status.${p.status}`);
                return (
                  <tr key={p.dueOn} className="border-b border-border last:border-b-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium tabular-nums">
                      <span className="flex items-center gap-2">
                        <StatusMark status={p.status} label={status} />
                        {formatDay(p.dueOn, language)}
                      </span>
                    </th>
                    <td className="py-2 pr-3 text-tiny text-muted-foreground">{status}</td>
                    <td className="py-2 text-right tabular-nums">
                      {p.received.amountMinor > 0 && p.status !== 'paid'
                        ? k('receivedOf', {
                            received: money(p.received),
                            expected: money(p.expected),
                          })
                        : money(p.expected)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {periods.length > shown.length || all ? (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setAll((x) => !x)}>
                {all ? k('showLess') : k('showAll', { n: periods.length })}
              </Button>
            </div>
          ) : null}
        </section>
      )}
      <section className="flex flex-col gap-2" data-testid="contract-documents">
        <h3 className="text-button font-semibold">{k('documents')}</h3>
        {item.documents && item.documents.length > 0 ? (
          <ul className="flex flex-col">
            {item.documents.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border py-2 text-button last:border-b-0"
              >
                <ItemLink owner={owner} target={d}>
                  {d.title}
                </ItemLink>
                {d.payment && (
                  <span className="text-tiny text-muted-foreground tabular-nums">
                    {k('paymentOn', {
                      amount: money(d.payment.amount),
                      date: formatDay(d.payment.paidOn, language),
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-tiny text-muted-foreground">{k('noDocuments')}</p>
        )}
      </section>
    </>
  );
}
