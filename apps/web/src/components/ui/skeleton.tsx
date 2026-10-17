import { cn } from '@/lib/utils';

/**
 * A grey placeholder block that breathes while its content loads (`animate-skeleton`; still
 * under reduced motion). Decorative: the region around it says it is busy (`aria-busy`).
 * Size and shape come from `className`; the default fill reads on white cards.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('animate-skeleton rounded-md bg-muted', className)} />
  );
}

/**
 * Placeholder chat rows (avatar, name, a line of text) for a message list that is loading, in
 * the rows' own spacing so nothing jumps when the messages arrive.
 */
export function MessageSkeletons({ rows = 4 }: { rows?: number }) {
  const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/12'];
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-4 pt-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className={cn('h-3', widths[i % widths.length])} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Three grey board columns (the task boards' column size) while a board loads. */
export function ColumnSkeletons() {
  return (
    <div aria-hidden="true" className="flex gap-3 overflow-hidden">
      {[0, 1, 2].map((column) => (
        <div
          key={column}
          className="flex w-[calc(100vw-56px)] shrink-0 flex-col gap-2 rounded-xl bg-muted p-3 min-[641px]:w-72"
        >
          <Skeleton className="h-4 w-24 bg-secondary" />
          <Skeleton className="h-20 rounded-lg bg-card" />
          <Skeleton className="h-20 rounded-lg bg-card" />
        </div>
      ))}
    </div>
  );
}

/**
 * A white card of grey rows (a bold line over a lighter one) for a list that is loading: the
 * groups, the admins, the bulk emails. `rowClassName` sets the rows' height to match the real ones.
 */
export function ListSkeleton({ rows = 4, rowClassName }: { rows?: number; rowClassName?: string }) {
  return (
    <div aria-hidden="true" className="flex flex-col rounded-xl bg-card py-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn('flex flex-col justify-center gap-2 px-5 py-3', rowClassName)}>
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      ))}
    </div>
  );
}
