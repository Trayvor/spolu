/**
 * A horizontal proportional bar as plain CSS (ADR 0028): a ranking row's share of the largest
 * value. Decorative; the row shows the number itself. Part D's rankings use it.
 */
export function RankBar({
  value,
  max,
  tone = 'solid',
}: {
  value: number;
  max: number;
  tone?: 'solid' | 'cost';
}) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span aria-hidden="true" className="block h-2 w-full overflow-hidden rounded-full bg-secondary">
      <span
        className="block h-full rounded-full"
        style={{
          width: `${share * 100}%`,
          background: tone === 'cost' ? 'var(--chart-3)' : 'var(--chart-1)',
        }}
      />
    </span>
  );
}
