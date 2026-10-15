import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * egrant.sk select: a native `<select>` with the input's look (white, 2px border, 8px radius)
 * and a 16px chevron inside on the right. `className` goes on the select, `containerClassName`
 * on the box around it (for flex sizing).
 */
function Select({
  className,
  containerClassName,
  children,
  ...props
}: React.ComponentProps<'select'> & { containerClassName?: string }) {
  return (
    <div className={cn('relative inline-flex', containerClassName)}>
      <select
        data-slot="select"
        className={cn(
          'w-full appearance-none rounded-md border-2 border-input bg-card py-[13px] pr-10 pl-[18px] text-button font-medium text-foreground transition-colors duration-(--duration-fast) focus:border-foreground disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-foreground"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

export { Select };
