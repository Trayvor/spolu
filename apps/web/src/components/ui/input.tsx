import * as React from 'react';
import { cn } from '@/lib/utils';

/** egrant.sk field: white, 2px border, 8px radius. Set `aria-invalid` for the error look. */
function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'w-full rounded-md border-2 border-input bg-card px-[18px] py-[13px] text-button font-medium text-foreground transition-colors duration-(--duration-fast) placeholder:text-muted-foreground focus:border-foreground disabled:opacity-50 aria-invalid:border-destructive aria-invalid:text-error-ink aria-invalid:placeholder:text-error-ink',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
