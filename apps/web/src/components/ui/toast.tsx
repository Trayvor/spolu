import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { POPOVER } from './popover';

/** How long a toast stays on screen (not counting pauses) before it closes by itself. */
const TOAST_MS = 6000;

/**
 * The one toast queue of the app: the ids of the mounted toasts, oldest first. Only the head is
 * on screen; the next one shows when it closes, so two toasts never overlay each other.
 */
let queue: string[] = [];
const listeners = new Set<() => void>();

function setQueue(next: string[]) {
  queue = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const head = () => queue[0];

/** A button on the toast that does something and closes it ("Vrátiť späť"). */
export type ToastAction = { label: string; onAction: () => void };

/**
 * A short confirmation at the bottom centre of the window: a popover bar (`POPOVER`) holding a
 * `role="status"` region, an optional action button and a close button.
 *
 * Every `<Toast>` joins one app-wide queue while it is mounted, and only the oldest is shown, so
 * a second toast waits for the first. The shown one closes after `duration` (6 s by default) or
 * on its close button; hovering it or moving the focus into it pauses the countdown, and leaving
 * resumes it with the time that was left. The action button runs `onAction`, then closes.
 *
 * The region mounts empty and gets its content on the next tick: screen readers announce changes
 * to a live region, not a region that arrives already filled. It rises in (`animate-toast-in`,
 * 200 ms; none under reduced motion). It is portalled into `document.body`: rendered inside a
 * positioned column (the ticket page's sticky details), it would sit under a later column such
 * as the ticket chat and its composer.
 */
export function Toast({
  children,
  onClose,
  action,
  duration = TOAST_MS,
}: {
  children: ReactNode;
  onClose: () => void;
  action?: ToastAction;
  duration?: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  // A new `onClose` or `action` from a re-render does not restart the countdown.
  const close = useRef(onClose);
  const act = useRef(action);
  useEffect(() => {
    close.current = onClose;
    act.current = action;
  });

  useEffect(() => {
    setQueue([...queue, id]);
    return () => setQueue(queue.filter((queued) => queued !== id));
  }, [id]);
  const shown = useSyncExternalStore(subscribe, head, head) === id;

  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const fill = setTimeout(() => setFilled(true), 0);
    return () => clearTimeout(fill);
  }, [shown]);

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const left = useRef(duration);
  useEffect(() => {
    if (!shown || paused) return;
    const started = Date.now();
    const timer = setTimeout(() => close.current(), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [shown, paused]);

  if (!shown) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
      <div
        className={`pointer-events-auto flex max-w-full animate-toast-in items-center gap-3 py-2 pr-2 pl-4 text-button font-medium ${POPOVER}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        <div role="status" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {filled && children}
        </div>
        {action && (
          <button
            type="button"
            onClick={() => {
              act.current?.onAction();
              close.current();
            }}
            className="min-h-11 shrink-0 rounded-full px-3 font-semibold underline underline-offset-4 hover:bg-accent"
          >
            {action.label}
          </button>
        )}
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
    </div>,
    document.body,
  );
}
