import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** An on / off switch labelled "Urgent". */
export function UrgentSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        // 24 px tall; the hit area above and below makes it 44 px to tap.
        data-hit
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border-2 before:absolute before:-inset-x-0.5 before:-inset-y-2.5 before:content-[''] transition-colors duration-(--duration-fast)",
          checked ? 'border-foreground bg-foreground' : 'border-input bg-card',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 size-4 rounded-full',
            checked ? 'left-[22px] bg-primary-foreground' : 'left-0.5 bg-input',
          )}
        />
      </button>
      <span id={labelId} className="text-button font-semibold">
        {t('tasks.form.urgent')}
      </span>
    </div>
  );
}
