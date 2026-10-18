import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Month } from '@spolu/shared';
import { cn } from '@/lib/utils';
import { monthAxis, monthName, niceScale } from './scale';

/**
 * Bars by month in hand-written SVG (ADR 0028): per month one or more groups side by side, each
 * a stack of series (the money view: paid under to be paid, and a thinner cost bar next to it).
 * A zero line, a few gridlines with round values, month labels never rotated (every n-th on
 * narrow widths). Each month is a focusable column with a tooltip and a spoken summary; the
 * card's "Show as table" gives the same numbers as a table (`ChartTable`). Colours come from the
 * `--chart-*` tokens; the only motion is a 150 ms opacity on the other months while one is
 * pointed at.
 */

/** `out` (Phase 32 E): the organisation's money out, on `/finance` with every client. */
export type BarTone = 'solid' | 'light' | 'cost' | 'out';

type BarSeries = {
  key: string;
  label: string;
  tone: BarTone;
  values: ReadonlyMap<Month, number>;
};

/** Series stacked in one bar; a `thin` group is half as wide. */
export type BarGroup = { series: BarSeries[]; thin?: boolean };

const TONE_FILL: Record<BarTone, string> = {
  solid: 'var(--chart-1)',
  light: 'var(--chart-2)',
  cost: 'var(--chart-3)',
  out: 'var(--chart-4)',
};

/** The element's width, kept up to date (the chart draws in pixels, so text never stretches). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry!.contentRect.width)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function MonthBars({
  months,
  groups,
  format,
  label,
  height = 200,
  max,
  compact = false,
}: {
  months: readonly Month[];
  groups: readonly BarGroup[];
  /** A value as shown on the axis and in the tooltip. */
  format: (value: number) => string;
  /** The chart's accessible name. */
  label: string;
  height?: number;
  /** A shared top of the y axis (small multiples compare on one scale). */
  max?: number;
  /** Small multiples: no y labels, two gridlines. */
  compact?: boolean;
}) {
  const { i18n } = useTranslation();
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<Month | null>(null);
  const hatch = useId().replaceAll(':', '');

  const stackTotal = (group: BarGroup, month: Month) =>
    group.series.reduce((sum, s) => sum + (s.values.get(month) ?? 0), 0);
  const top = max ?? Math.max(0, ...months.flatMap((m) => groups.map((g) => stackTotal(g, m))));
  const scale = niceScale(top, compact ? 2 : 4);

  const left = compact ? 2 : 56;
  const bottom = 22;
  const plotTop = 8;
  const innerW = Math.max(0, width - left - 2);
  const innerH = height - bottom - plotTop;
  const slot = months.length > 0 ? innerW / months.length : 0;
  const weights = groups.map((g) => (g.thin ? 1 : 2));
  const unit =
    (slot * 0.72) /
    Math.max(
      1,
      weights.reduce((a, b) => a + b, 0),
    );
  const y = (value: number) => plotTop + innerH - (value / scale.max) * innerH;
  const labels = monthAxis(months, i18n.language, Math.max(2, Math.floor(innerW / 44)));

  const summary = (month: Month) =>
    `${monthName(month, i18n.language)}: ${groups
      .flatMap((g) => g.series)
      .map((s) => `${s.label} ${format(s.values.get(month) ?? 0)}`)
      .join(', ')}`;

  return (
    <div ref={box} role="group" aria-label={label} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block overflow-visible"
          onPointerLeave={() => setActive(null)}
        >
          <defs>
            <pattern
              id={hatch}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="var(--chart-2)" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="var(--chart-1)"
                strokeWidth="1.5"
                strokeOpacity="0.35"
              />
            </pattern>
          </defs>
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={left}
                x2={left + innerW}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--border)"
                strokeWidth={tick === 0 ? 2 : 1}
              />
              {!compact && (
                <text
                  x={left - 8}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-nano tabular-nums"
                >
                  {format(tick)}
                </text>
              )}
            </g>
          ))}
          {months.map((month, i) => {
            const x0 = left + i * slot + slot * 0.14;
            let offset = 0;
            const dim = active !== null && active !== month;
            return (
              <g
                key={month}
                tabIndex={0}
                role="img"
                aria-label={summary(month)}
                onPointerEnter={() => setActive(month)}
                onFocus={() => setActive(month)}
                onBlur={() => setActive(null)}
                className="outline-none transition-opacity duration-(--duration-fast) focus-visible:[&>rect.hit]:stroke-ring"
                style={{ opacity: dim ? 0.45 : 1 }}
              >
                <rect
                  className="hit"
                  x={left + i * slot}
                  y={plotTop}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  strokeWidth={2}
                />
                {groups.map((group, g) => {
                  const w = unit * weights[g]!;
                  const x = x0 + offset;
                  offset += w;
                  let base = 0;
                  return group.series.map((s) => {
                    const value = s.values.get(month) ?? 0;
                    if (value <= 0) return null;
                    const yTop = y(base + value);
                    const h = y(base) - yTop;
                    base += value;
                    return (
                      <rect
                        key={`${g}-${s.key}`}
                        x={x}
                        y={yTop}
                        width={Math.max(1, w - 1)}
                        height={Math.max(1, h)}
                        rx={Math.min(2, w / 4)}
                        fill={s.tone === 'light' ? `url(#${hatch})` : TONE_FILL[s.tone]}
                      />
                    );
                  });
                })}
              </g>
            );
          })}
          {labels.map(
            (l, i) =>
              l.show && (
                <text
                  key={l.month}
                  x={left + i * slot + slot / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-nano"
                  aria-hidden="true"
                >
                  {l.label}
                </text>
              ),
          )}
        </svg>
      )}
      {active !== null && width > 0 && (
        <div
          role="presentation"
          className={cn(
            'pointer-events-none absolute top-0 z-10 w-max max-w-[220px] -translate-x-1/2 rounded-lg bg-popover px-3 py-2 text-tiny shadow-lift',
          )}
          style={{
            left: Math.min(
              Math.max(left + (months.indexOf(active) + 0.5) * slot, 90),
              Math.max(90, width - 90),
            ),
          }}
        >
          <p className="font-semibold">{monthName(active, i18n.language)}</p>
          {groups
            .flatMap((g) => g.series)
            .map((s) => (
              <p key={s.key} className="flex items-center gap-2 tabular-nums">
                <span
                  aria-hidden="true"
                  className="inline-block size-2.5 rounded-sm"
                  style={{ background: TONE_FILL[s.tone] }}
                />
                {s.label}: {format(s.values.get(active) ?? 0)}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

/** A legend swatch for the series of a chart (same fills as the bars). */
export function Swatch({ tone }: { tone: BarTone }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-sm',
        tone === 'light' && 'outline outline-1 -outline-offset-1 outline-surface-3',
      )}
      style={{ background: TONE_FILL[tone] }}
    />
  );
}
