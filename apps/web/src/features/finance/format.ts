import { useTranslation } from 'react-i18next';
import { COST_CURRENCY, formatDuration, formatMoney, type Currency } from '@spolu/shared';

/**
 * Hours and money in the UI language for the finance cards: durations as "1 h 30 min" with the
 * `finance.units` words, amounts with `Intl` (whole units on totals and charts).
 */
export function useFinanceFormat() {
  const { t, i18n } = useTranslation();
  const units = { hours: t('finance.units.hours'), minutes: t('finance.units.minutes') };
  const locale = i18n.language;
  return {
    duration: (minutes: number) => formatDuration(minutes, units),
    /** Whole hours with one decimal at most, for axes: "12,5 h". */
    hours: (minutes: number) =>
      `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(minutes / 60)} ${units.hours}`,
    money: (amountMinor: number, currency: Currency = COST_CURRENCY, whole = true) =>
      formatMoney({ amountMinor, currency }, locale, { whole }),
    day: (day: string) =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${day}T00:00:00Z`)),
  };
}
