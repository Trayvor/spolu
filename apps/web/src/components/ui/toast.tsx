import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** How long a toast stays before it closes by itself. */
const TOAST_MS = 6000;

/**
 * A short confirmation at the bottom centre of the window: a `bg-popover` bar with `shadow-lift`,
 * `role="status"`, and a close button. It closes after 6 s or on that button. No animation.
 */
export function Toast({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const { t } = useTranslation();
  // The timer starts once; a new `onClose` from a re-render does not restart it.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const timer = setTimeout(() => close.current(), TOAST_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex max-w-full items-center gap-3 rounded-xl bg-popover py-2 pr-2 pl-4 text-button font-medium text-popover-foreground shadow-lift"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{children}</div>
        <button
          type="button"
          aria-label={t('toast.close')}
          onClick={() => close.current()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
