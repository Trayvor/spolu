// Eager (the Tasks tab badge): keep it tiny.

/**
 * How many open tasks are assigned to me, as a small yellow pill with ink text (`99+` above 99),
 * nothing at 0. The only use of the `attention` yellow; it stays yellow inside the active ink tab.
 */
export function AssignedPill({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-attention px-1.5 text-nano font-semibold text-attention-foreground tabular-nums">
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
