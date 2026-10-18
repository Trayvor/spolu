import { useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Visibilities, type Visibility } from '@spolu/shared';
import { cn } from '@/lib/utils';

const FIELD = 'flex flex-col gap-2.5';

/** "Only eGrant" first in the admin group: it is the default there. */
const ADMIN_GROUP_ORDER: readonly Visibility[] = ['admins', 'public'];

/**
 * "Visible to": two pills in a track, the chosen one ink. A radio group: arrows move the choice.
 * In the admin group (Phase 34, `adminGroup`) the pills read "Only eGrant" and "Shareable with
 * clients", and choosing the second says what it means.
 */
export function VisibilityControl({
  value,
  onChange,
  disabled,
  hint,
  adminGroup = false,
}: {
  value: Visibility;
  onChange: (next: Visibility) => void;
  disabled: boolean;
  hint?: string;
  adminGroup?: boolean;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const order = adminGroup ? ADMIN_GROUP_ORDER : Visibilities;
  const shown =
    hint ?? (adminGroup && value === 'public' ? t('knowledge.adminGroup.consequence') : undefined);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = order.indexOf(value);
    const next = (index + step + order.length) % order.length;
    onChange(order[next]!);
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
        aria-describedby={shown ? `${uid}-hint` : undefined}
        onKeyDown={onKeyDown}
        className="inline-flex max-w-full self-start rounded-full bg-secondary p-1"
      >
        {order.map((option, i) => {
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
              {adminGroup && option === 'public'
                ? t('knowledge.adminGroup.shareable')
                : t(`knowledge.visibility.${option}`)}
            </button>
          );
        })}
      </div>
      {shown && (
        <p id={`${uid}-hint`} className="text-tiny text-muted-foreground">
          {shown}
        </p>
      )}
    </div>
  );
}
