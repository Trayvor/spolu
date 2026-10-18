import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/select';
import { useSession } from '@/features/auth/use-session';
import {
  readRemembered,
  rememberedFiltersKey,
  useRememberedState,
  writeRemembered,
} from '@/lib/use-remembered-filters';
import { currentMonth, rangeOf, type MonthRange, type Period } from './period';

/**
 * A card's period filter: a preset select and, for "Custom range", two month fields; both are
 * remembered per person (the range under `<list>.custom`). Returns the range to query (null: all
 * time).
 */
export function usePeriod(list: string, periods: readonly Period[]) {
  const presets = periods.filter((p) => p !== 'custom');
  const [saved, setSaved] = useRememberedState<Period>(list, presets);
  const userId = useSession()?.id ?? null;
  const customKey = userId === null ? null : rememberedFiltersKey(userId, `${list}.custom`);
  const [custom, setCustomState] = useState<{ from: string; to: string } | null>(() => {
    const saved = customKey ? readRemembered(customKey) : null;
    return typeof saved?.from === 'string' && typeof saved.to === 'string'
      ? { from: saved.from, to: saved.to }
      : null;
  });
  const setCustom = (next: { from: string; to: string } | null) => {
    setCustomState(next);
    if (customKey) writeRemembered(customKey, next);
  };
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
