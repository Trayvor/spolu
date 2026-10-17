import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * A row of mutually exclusive pills (a radio group) in the app's filter-pill look: the chosen one
 * is the filled ink pill. Arrow keys move the choice, as in a native radio group.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const next = (index + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex max-w-full rounded-full bg-secondary p-1', className)}
    >
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-8 min-w-0 flex-1 truncate rounded-full px-3 text-tiny font-semibold transition-colors duration-(--duration-fast)',
              checked ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-surface-3',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
