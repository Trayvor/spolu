import { useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Visibilities, type Visibility } from '@spolu/shared';
import { cn } from '@/lib/utils';

const FIELD = 'flex flex-col gap-2.5';

/**
 * "Visible to": two pills in a track, the chosen one ink. A radio group: arrows move the choice.
 */
export function VisibilityControl({
  value,
  onChange,
  disabled,
  hint,
}: {
  value: Visibility;
  onChange: (next: Visibility) => void;
  disabled: boolean;
  hint?: string;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = Visibilities.indexOf(value);
    const next = (index + step + Visibilities.length) % Visibilities.length;
    onChange(Visibilities[next]!);
    refs.current[next]?.focus();
  };

  return (
    <div className={FIELD}>
      <span id={`${uid}-label`} data-field-label className="text-button font-semibold">
        {t('knowledge.form.visibleTo')}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${uid}-label`}
        aria-describedby={hint ? `${uid}-hint` : undefined}
        onKeyDown={onKeyDown}
        className="inline-flex max-w-full self-start rounded-full bg-secondary p-1"
      >
        {Visibilities.map((option, i) => {
          const checked = option === value;
          return (
            <button
              key={option}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option)}
              className={cn(
                'h-8 min-w-0 truncate rounded-full px-4 text-tiny font-semibold transition-colors duration-(--duration-fast) disabled:cursor-not-allowed',
                checked
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-surface-3 disabled:hover:bg-transparent',
                disabled && !checked && 'text-muted-foreground',
              )}
            >
              {t(`knowledge.visibility.${option}`)}
            </button>
          );
        })}
      </div>
      {hint && (
        <p id={`${uid}-hint`} className="text-tiny text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
