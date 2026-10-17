import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** One result of a picker tab: a checkbox, then the item's own look. Disabled at the limit. */
export function PickRow({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <label
        className={cn(
          'flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          className="size-4 shrink-0 accent-brand-purple"
        />
        {children}
      </label>
    </li>
  );
}
