import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-button font-semibold whitespace-nowrap transition-colors duration-(--duration-fast) disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 max-[640px]:relative max-[640px]:after:absolute max-[640px]:after:content-['']",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-ink-hover active:bg-black',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border-2 border-primary bg-transparent text-foreground hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-surface-3',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'rounded-none text-foreground underline-offset-4 hover:text-neutral hover:underline',
      },
      size: {
        // On phones each size under 44 px gets a transparent 44 px tap area around it (`after`).
        default: 'h-[38px] px-5 max-[640px]:after:inset-x-0 max-[640px]:after:-inset-y-[3px]',
        sm: 'h-8 px-4 text-tiny max-[640px]:after:inset-x-0 max-[640px]:after:-inset-y-1.5',
        lg: 'h-11 px-6',
        icon: 'size-[38px] max-[640px]:after:-inset-[3px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
