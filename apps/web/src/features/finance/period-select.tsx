import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/select';
import { useRememberedState } from '@/lib/use-remembered-filters';
import { currentMonth, rangeOf, type MonthRange, type Period } from './period';

/**
 * A card's period filter: a preset select (remembered per person, the custom range is not), and
 * for "Custom range" two month fields. Returns the range to query (null: all time).
 */
export function usePeriod(list: string, periods: readonly Period[]) {
  const presets = periods.filter((p) => p !== 'custom');
  const [saved, setSaved] = useRememberedState<Period>(list, presets);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const period: Period = custom ? 'custom' : (saved ?? periods[0]!);
  const choose = (next: Period) => {
    if (next === 'custom') {
      const month = currentMonth();
      setCustom({ from: month, to: month });
      return;
    }
    setCustom(null);
    setSaved(next === periods[0] ? null : next);
  };
  return { period, range: rangeOf(period, custom), custom, setCustom, choose, periods };
}

/** A period filter's state: a card's own, or `/finance`'s page-wide one. */
export type PeriodState = ReturnType<typeof usePeriod>;

export function PeriodSelect({ state, label }: { state: PeriodState; label?: string }) {
  const { t } = useTranslation();
  const id = useId();
  const { period, custom, setCustom, choose, periods } = state;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label ?? t('financeLog.period')}
      </label>
      <Select
        id={id}
        value={period}
        onChange={(e) => choose(e.target.value as Period)}
        className="h-9 py-0 pr-9 pl-3 text-tiny"
      >
        {periods.map((p) => (
          <option key={p} value={p}>
            {t(`finance.periods.${p}`)}
          </option>
        ))}
      </Select>
      {custom && (
        <span className="flex items-center gap-1.5 text-tiny">
          <input
            type="month"
            aria-label={t('financeLog.from')}
            value={custom.from}
            onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            className="h-9 rounded-md border-2 border-input bg-card px-2 text-tiny"
          />
          <span aria-hidden="true">–</span>
          <input
            type="month"
            aria-label={t('financeLog.to')}
            value={custom.to}
            onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            className="h-9 rounded-md border-2 border-input bg-card px-2 text-tiny"
          />
        </span>
      )}
    </div>
  );
}

export type { MonthRange };
