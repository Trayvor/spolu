import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type TouchEvent,
  type MouseEvent,
} from 'react';
import { useScrollLock } from '@/lib/use-scroll-lock';
import { cn } from '@/lib/utils';

/** How far (px) a downward drag on the sheet must go to close it. */
const SWIPE_CLOSE = 64;
/** The longest close animation (`animate-sheet-out`), so a missed `animationend` never sticks. */
const CLOSE_MS = 200;

/**
 * A modal bottom sheet on the native `<dialog>`: the browser traps the focus, makes the page
 * behind inert, closes on Escape and puts the focus back on the button that opened it. No
 * library. Open while mounted; `onClose` asks the caller to unmount it, after the sheet has slid
 * down (`animate-sheet-out`; at once under reduced motion). Closes on a tap on the dimmed
 * backdrop, Escape, a downward swipe, or a tap on a link inside (it navigates, the sheet goes).
 * `max-height` leaves the top 10% of the screen visible; the content scrolls inside; the bottom
 * padding clears the iPhone home bar.
 */
export function BottomSheet({
  label,
  onClose,
  className,
  children,
}: {
  label: string;
  onClose: () => void;
  /** More classes for the `<dialog>`, e.g. another shape on wide screens. */
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const startY = useRef<number | null>(null);
  const closing = useRef(false);
  useScrollLock(true);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    // jsdom (tests) has no `showModal`.
    if (typeof node.showModal === 'function') node.showModal();
    else node.setAttribute('open', '');
  }, []);

  const close = useCallback(() => {
    const node = dialog.current;
    if (!node || closing.current) return;
    closing.current = true;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (typeof node.close === 'function') node.close();
      onClose();
    };
    node.dataset.closing = '';
    node.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, CLOSE_MS);
  }, [onClose]);

  const onTouchStart = (event: TouchEvent) => {
    startY.current = event.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (startY.current !== null && y !== undefined && y - startY.current > SWIPE_CLOSE) {
      startY.current = null;
      close();
    }
  };
  // A click on the dialog element itself is a click on its backdrop: the panel fills the rest.
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    const target = event.target as Element;
    if (target === event.currentTarget || target.closest('a[href]')) close();
  };

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      className={cn(
        'fixed inset-x-0 top-auto bottom-0 m-0 max-h-[90dvh] w-full max-w-none animate-sheet-in overflow-y-auto overscroll-contain rounded-t-xl bg-popover p-0 text-popover-foreground shadow-lift backdrop:animate-fade-in backdrop:bg-foreground/30 data-closing:animate-sheet-out data-closing:backdrop:animate-fade-out',
        className,
      )}
    >
      <div className="px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-8 rounded-full bg-surface-3" />
        {children}
      </div>
    </dialog>
  );
}
