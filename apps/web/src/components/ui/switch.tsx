import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/**
 * On/off switch (Radix `Switch`, role `switch`) in egrant tokens: a 44×26 pill, `surface-3`
 * off and `ink` on, a 20px white knob. Name it with `aria-labelledby` or a `<label>`.
 * The knob slides in 150ms only under `motion-safe:`.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-[26px] w-11 shrink-0 items-center rounded-full bg-surface-3 p-[3px] transition-colors duration-(--duration-fast) disabled:opacity-50 data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 rounded-full bg-card shadow-lift motion-safe:transition-transform motion-safe:duration-(--duration-fast) data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
