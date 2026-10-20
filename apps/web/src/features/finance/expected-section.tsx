import { useTranslation } from 'react-i18next';
import type { FinanceOverviewDto } from '@spolu/shared';
import { useUpdateSearch } from '@/lib/use-update-search';
import { StatusMark, useScheduleLine } from './documents/contract-view';
import { formatDay } from './documents/format';
import { useFinanceFormat } from './format';

/**
 * The Summary card's expected payments (ADR 0066, "očakávané"): the period's payments the
 * contracts' schedules expect against what their linked documents received, and one line per
 * scheduled contract — "+600 € každý mesiac", a mark per latest due period (paid, partly paid,
 * unpaid), the next expected day. Counted apart from the contracts' money above it. A line opens
 * the contract (`?item=`) where the Documents card can show it (a client's tab).
 */
export function ExpectedSection({
  data,
  currency,
  canOpen,
}: {
  data: FinanceOverviewDto;
  currency: string;
  /** The page shows items by `?item=` (a client's tab). */
  canOpen: boolean;
}) {
  const { t, i18n } = useTranslation();
  const f = useFinanceFormat();
  const line = useScheduleLine();
  const updateSearch = useUpdateSearch();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`financeLog.expected.${key}`, options);
  const s = (key: string) => t(`financeDocuments.contracts.status.${key}`);
  const schedules = (data.schedules ?? []).filter((x) => x.amount.currency === currency);
  const totals = (data.expected ?? []).find((x) => x.currency === currency);
  if (schedules.length === 0 && !totals) return null;
  return (
    <section
      className="flex flex-col gap-3 border-t-2 border-border pt-4"
      aria-labelledby="finance-expected-title"
      data-testid="finance-expected"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="finance-expected-title" className="text-button font-semibold">
          {k('title')}
        </h3>
        {totals && (
          <p className="text-tiny text-muted-foreground tabular-nums">
            {k('totals', {
              expected: f.money(totals.expected, totals.currency),
              received: f.money(totals.received, totals.currency),
            })}
          </p>
        )}
      </div>
      <ul className="flex flex-col">
        {schedules.map((x) => {
          const title = <span className="min-w-0 truncate font-medium">{x.title}</span>;
          return (
            <li
              key={x.contractId}
              className="flex flex-col gap-1 border-b border-border py-2 text-button last:border-b-0 @min-[640px]:flex-row @min-[640px]:items-center @min-[640px]:gap-4"
            >
              {canOpen ? (
                <button
                  type="button"
                  className="min-w-0 text-left hover:underline @min-[640px]:basis-[35%]"
                  onClick={() =>
                    updateSearch((q) => void (q.item = x.contractId), { replace: false })
                  }
                >
                  {title}
                </button>
              ) : (
                <span className="min-w-0 @min-[640px]:basis-[35%]">{title}</span>
              )}
              <span className="font-semibold tabular-nums @min-[640px]:basis-[25%]">{line(x)}</span>
              <span className="flex items-center gap-1" aria-label={k('recent')}>
                {x.recent.map((p) => (
                  <StatusMark
                    key={p.dueOn}
                    status={p.status}
                    label={`${formatDay(p.dueOn, i18n.language)}: ${s(p.status)}`}
                  />
                ))}
              </span>
              <span className="text-tiny text-muted-foreground tabular-nums @min-[640px]:ml-auto">
                {x.unpaidCount > 0 && (
                  <span className="mr-2 font-semibold text-error-ink">
                    {k('unpaid', { n: x.unpaidCount })}
                  </span>
                )}
                {x.upcoming[0]
                  ? k('next', { date: formatDay(x.upcoming[0].dueOn, i18n.language) })
                  : k('over')}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
