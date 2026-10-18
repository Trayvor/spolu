import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const BackIcon = () => (
  <Icon>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);

/**
 * A panel's or a sheet's top bar: a back arrow below `compactBelow` px, "Close" from there, then
 * `children` on the right. 1024 for the task panel (full screen below 1024 px), 641 for a
 * `SheetDialog` (full screen below 641 px). Needs the `forms` locale namespace.
 */
export function PanelHeader({
  onClose,
  children,
  compactBelow = 1024,
  backLabel,
}: {
  onClose: () => void;
  children: ReactNode;
  compactBelow?: 641 | 1024;
  /** The back arrow's label (visible from 641 px, read out below); "Back to the board" by default. */
  backLabel?: string;
}) {
  const { t } = useTranslation();
  // Whole class names, so Tailwind finds them.
  const narrow = compactBelow === 1024;
  return (
    <header className="flex items-center gap-2 border-b-2 border-border px-3 py-2 min-[641px]:px-4 min-[641px]:py-3">
      {/* Phones: a back arrow only (the label stays for screen readers), so the bucket select fits. */}
      <Button
        variant="ghost"
        onClick={onClose}
        className={cn(
          narrow ? 'lg:hidden' : 'min-[641px]:hidden',
          'max-[640px]:size-11 max-[640px]:px-0',
        )}
      >
        <BackIcon />
        <span className="max-[640px]:sr-only">{backLabel ?? t('forms.panel.back')}</span>
      </Button>
      <Button
        variant="ghost"
        onClick={onClose}
        className={narrow ? 'max-lg:hidden' : 'max-[640px]:hidden'}
      >
        {t('forms.panel.close')}
      </Button>
      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
    </header>
  );
}
