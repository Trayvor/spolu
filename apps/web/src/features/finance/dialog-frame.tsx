import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';

/**
 * The inside of a finance `SheetDialog` (entry, rates): the title with Close, a body that
 * scrolls, and a footer that clears the phone's home bar. A form when `onSubmit` is given.
 */
export function DialogFrame({
  title,
  onClose,
  onSubmit,
  footer,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const inner = (
    <>
      <header className="flex items-center gap-3 border-b-2 border-border px-4 py-3 min-[641px]:px-6">
        <div className="min-w-0 flex-1">{title}</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('financeLog.close')}
          onClick={onClose}
        >
          <CloseIcon />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 min-[641px]:px-6 min-[641px]:py-5">
        {children}
      </div>
      {footer && (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t-2 border-border px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] min-[641px]:px-6">
          {footer}
        </footer>
      )}
    </>
  );
  if (!onSubmit) return <div className="flex min-h-0 flex-1 flex-col">{inner}</div>;
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {inner}
    </form>
  );
}
