import { useTranslation } from 'react-i18next';
import type { Month } from '@spolu/shared';
import { monthName } from './scale';

/**
 * The numbers of a chart as an accessible table ("Show as table", ADR 0028): one row per month,
 * one column per series, months without any value left out.
 */
export function ChartTable({
  caption,
  months,
  columns,
}: {
  caption: string;
  months: readonly Month[];
  columns: readonly {
    key: string;
    label: string;
    values: ReadonlyMap<Month, number>;
    format: (v: number) => string;
  }[];
}) {
  const { t, i18n } = useTranslation();
  const rows = months.filter((m) => columns.some((c) => (c.values.get(m) ?? 0) !== 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-tiny tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-border text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-semibold">
              {t('financeLog.charts.month')}
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="py-2 pl-3 text-right font-semibold">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((month) => (
            <tr key={month} className="border-b border-border last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-medium">
                {monthName(month, i18n.language)}
              </th>
              {columns.map((c) => (
                <td key={c.key} className="py-2 pl-3 text-right">
                  {c.format(c.values.get(month) ?? 0)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="py-3 text-muted-foreground">
                {t('financeLog.charts.noData')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
