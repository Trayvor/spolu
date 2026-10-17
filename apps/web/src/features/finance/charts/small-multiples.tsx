import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Month } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { MonthBars } from './month-bars';
import { niceScale } from './scale';

/**
 * One small bar chart per item (the hours view: one per admin), all on one y scale so they
 * compare at a glance (ADR 0028). The first `limit` show, then "Show all (n)".
 */
export type Multiple = {
  key: string;
  title: ReactNode;
  /** The chart's accessible name. */
  label: string;
  values: ReadonlyMap<Month, number>;
};

export function SmallMultiples({
  months,
  items,
  format,
  limit = 6,
  height = 96,
}: {
  months: readonly Month[];
  items: readonly Multiple[];
  format: (value: number) => string;
  limit?: number;
  height?: number;
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const top = niceScale(Math.max(0, ...items.flatMap((i) => [...i.values.values()])), 2).max;
  const shown = all ? items : items.slice(0, limit);
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-x-6 gap-y-4 @min-[560px]:grid-cols-2">
        {shown.map((item) => (
          <li key={item.key} className="flex min-w-0 flex-col gap-1">
            {item.title}
            <MonthBars
              months={months}
              groups={[
                { series: [{ key: 'v', label: item.label, tone: 'solid', values: item.values }] },
              ]}
              format={format}
              label={item.label}
              height={height}
              max={top}
              compact
            />
          </li>
        ))}
      </ul>
      {items.length > limit && (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setAll(!all)}>
          {all
            ? t('financeLog.charts.showFewer')
            : t('financeLog.charts.showAll', { count: items.length })}
        </Button>
      )}
    </div>
  );
}
