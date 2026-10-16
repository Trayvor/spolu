import { useTranslation } from 'react-i18next';
import { leafParts } from '@/features/reminders/format';
import { cn } from '@/lib/utils';

/** A small calendar leaf: the day over the short month, with an ink top edge. */
export function CalendarLeaf({
  iso,
  muted,
  size,
}: {
  iso: string;
  muted?: boolean;
  size: 32 | 40;
}) {
  const { i18n } = useTranslation();
  const { day, month } = leafParts(iso, i18n.language);
  return (
    <span
      aria-hidden="true"
      data-slot="calendar-leaf"
      data-muted={muted ? 'true' : undefined}
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 flex-col items-center justify-center rounded-lg border-t-2 bg-muted leading-none',
        muted
          ? 'border-muted-foreground text-muted-foreground'
          : 'border-foreground text-foreground',
      )}
    >
      <span className={cn('font-semibold', size === 40 ? 'text-button' : 'text-micro')}>{day}</span>
      <span className="text-nano text-muted-foreground">{month}</span>
    </span>
  );
}
