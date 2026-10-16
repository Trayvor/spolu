import { useEffect, useRef, type ReactNode, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '@/lib/use-scroll-lock';
import { cn } from '@/lib/utils';

/** How far (px) a downward drag on the sheet must go to close it. */
const SWIPE_CLOSE = 64;

/**
 * A bottom sheet of actions for touch screens: a dimmed backdrop and a `bg-popover` panel with
 * full-width rows (`ActionSheetItem`). Closes on a tap outside, Escape, or a downward swipe.
 * The page behind does not scroll while it is open (the task panel's `useScrollLock`). It rises
 * from the bottom edge over a fading backdrop (`animate-sheet-in`, `animate-fade-in`; none under
 * reduced motion) and goes at once on close. The caller puts the focus back where it came from.
 */
export function ActionSheet({
  open,
  label,
  onClose,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onTouchStart = (event: TouchEvent) => {
    startY.current = event.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (startY.current !== null && y !== undefined && y - startY.current > SWIPE_CLOSE) {
      startY.current = null;
      onClose();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        data-testid="sheet-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-foreground/30"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        className="relative max-h-[90dvh] animate-sheet-in overflow-y-auto overscroll-contain rounded-t-xl bg-popover px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] shadow-lift"
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-8 rounded-full bg-surface-3" />
        <div className="flex flex-col">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** One full-width 48 px row: a 16 px icon and the label; `danger` uses the error ink. */
export function ActionSheetItem({
  icon,
  label,
  danger = false,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-button font-medium hover:bg-accent focus-visible:bg-accent',
        danger ? 'text-error-ink' : 'text-foreground',
      )}
    >
      <span aria-hidden="true" className={cn('shrink-0', !danger && 'text-muted-foreground')}>
        {icon}
      </span>
      {label}
    </button>
  );
}
