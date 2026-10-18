import type { ReactNode } from 'react';
import { POPOVER } from './popover';

/**
 * A failure message that floats under the control it belongs to (the account menu's Log out,
 * the manager toggle, the bell): a `role="alert"` popover, right-aligned under its trigger, at
 * most 240px wide, `text-micro text-error-ink`. The parent must be `relative`. It fades in.
 */
export function ErrorBubble({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className={`absolute top-full right-0 z-10 mt-2 w-max max-w-[240px] animate-fade-in p-3 text-micro text-error-ink ${POPOVER}`}
    >
      {children}
    </p>
  );
}
