import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { Dialog } from 'radix-ui';
import { useBackCloses } from '@/lib/use-back-closes';
import { cn } from '@/lib/utils';

/**
 * Phones and touch screens (tablets too): every control is at least 44 px to tap (the task panel's rule, `PanelShell` in
 * `features/tasks/panel-parts.tsx`), except those that carry their own larger hit area
 * (`data-hit`), and the formatting toolbar wraps without gaps.
 */
const PHONE_TARGETS =
  'touch:[&_:is(button,a,select,input:not([type=checkbox],[type=radio])):not([data-hit])]:min-h-11 touch:[&_:is(button,a,select):not([data-hit])]:min-w-11 max-[640px]:[&_[role=toolbar]]:flex-wrap max-[640px]:[&_[role=toolbar]]:gap-0 max-[640px]:[&_[role=toolbar]]:px-0';

/**
 * A modal sheet: a centred 720 px dialog from 641 px (at most 880 px tall, 24 px clear of the
 * viewport) that grows in over a fading backdrop, a full-screen sheet below with no backdrop that
 * rises from the bottom edge (no motion under reduced motion; it goes at once on close). Always open while mounted: the caller
 * unmounts it to close. Clicks outside do nothing (unless `onOutside`), and Escape goes to `onEscape`, which decides
 * (ask first, close a layer, or close). Keys typed inside never reach the page's own handlers.
 * Name it with a `SheetDialogTitle` inside, or with `labelledBy`. Back (browser, Android, iOS
 * swipe) is Escape too: the sheet has a history entry of its own (`useBackCloses`), unless it is
 * already one by its URL (`urlOwned`: closing it changes a search param).
 */
export function SheetDialog({
  children,
  onEscape,
  initialFocus,
  testId,
  labelledBy,
  urlOwned = false,
  compact = false,
  onOutside,
}: {
  children: ReactNode;
  onEscape: (event: KeyboardEvent) => void;
  /** Gets the focus on open; without it Radix focuses the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** `data-testid` of the sheet; its backdrop gets `<testId>-backdrop`. */
  testId?: string;
  labelledBy?: string;
  /** Its open state is in the URL, so Back already closes it: no entry of its own. */
  urlOwned?: boolean;
  /** A short form (the time dialog, Phase 32): 480 px wide from 641 px instead of 720 px. */
  compact?: boolean;
  /**
   * A click outside (on the backdrop, from 641 px): only a sheet with nothing to lose closes on
   * it ("What's new"); without it a click outside does nothing.
   */
  onOutside?: () => void;
}) {
  useBackCloses(!urlOwned, () =>
    onEscape(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })),
  );
  return (
    <Dialog.Root open onOpenChange={() => undefined}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid={testId && `${testId}-backdrop`}
          className="fixed inset-0 z-50 animate-fade-in bg-foreground/30 max-[640px]:hidden"
        />
        <Dialog.Content
          data-testid={testId}
          aria-describedby={undefined}
          {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
          onEscapeKeyDown={onEscape}
          onOpenAutoFocus={(event) => {
            if (!initialFocus) return;
            event.preventDefault();
            initialFocus.current?.focus();
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            onOutside?.();
          }}
          onInteractOutside={(event) => event.preventDefault()}
          // React events bubble through portals: keys typed here must not reach the page's
          // handlers (the task panel closes on Escape).
          onKeyDown={(event: ReactKeyboardEvent) => event.stopPropagation()}
          className={cn(
            // Phones: the sheet rises from the bottom edge; wider: the dialog grows in a little.
            // Full screen on phones: its top clears the notch (each footer clears the home bar).
            'fixed inset-0 z-50 flex flex-col bg-popover text-popover-foreground outline-none max-[640px]:animate-sheet-in max-[640px]:pt-[env(safe-area-inset-top)] min-[641px]:animate-menu-in',
            'min-[641px]:inset-auto min-[641px]:top-1/2 min-[641px]:left-1/2 min-[641px]:max-h-[min(880px,calc(100dvh-48px))] min-[641px]:max-w-[calc(100vw-48px)] min-[641px]:-translate-x-1/2 min-[641px]:-translate-y-1/2 min-[641px]:rounded-xl min-[641px]:shadow-lift',
            compact ? 'min-[641px]:w-[480px]' : 'min-[641px]:w-[720px]',
            PHONE_TARGETS,
          )}
        >
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The sheet's accessible name (Radix `Dialog.Title`). */
export const SheetDialogTitle = Dialog.Title;
