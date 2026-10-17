import { useEffect, useRef, useState } from 'react';
import { useRouter, type AnyRouter } from '@tanstack/react-router';

/** The history state key of an open layer (sheet, dialog, menu). */
export const LAYER = 'layer';

/** The longest wait for a step back to land before the next layer pushes anyway. */
const SETTLE_MS = 1000;

let counter = 0;

/**
 * A step back that removes a closed layer's entry, while it is on its way: `history.back()` lands
 * later (a `popstate`), and an entry pushed before that would be the one it takes away. The next
 * layer pushes once it has landed.
 */
let settling: Promise<void> | undefined;

const layerOf = (state: unknown) => (state as Record<string, unknown> | undefined)?.[LAYER];

function stepBack(router: AnyRouter) {
  const landed = new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const unsubscribe = router.history.subscribe(({ action }: { action: { type: string } }) => {
      if (action.type !== 'PUSH' && action.type !== 'REPLACE') done();
    });
    const timer = setTimeout(done, SETTLE_MS);
  });
  const mine = landed.then(() => {
    if (settling === mine) settling = undefined;
  });
  settling = mine;
  router.history.back();
}

/**
 * Back closes the open layer first (a sheet, a dialog, the section menu) instead of leaving the
 * page: while `active`, the layer has a history entry of its own (the same URL, `state.layer`).
 * Back pops it and calls `onBack`, which closes the layer (or asks first; a layer still active
 * after it gets a new entry). A layer that animates out passes `active` false as soon as it
 * starts closing. A layer closed in the app removes its entry again with one step back, unless
 * the app has navigated meanwhile (a link or a submit inside it: links inside a layer should
 * `replace`, see `isLayerOpen`). Outside a router (unit tests) it does nothing.
 */
export function useBackCloses(active: boolean, onBack: () => void): void {
  const router = useRouter({ warn: false });
  const handler = useRef(onBack);
  useEffect(() => {
    handler.current = onBack;
  });
  const key = useRef<string | null>(null);
  // The entry has been seen in place (its push landed): only then can a pop take it away.
  const shown = useRef(false);
  const pendingBack = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped when Back popped the entry but the layer stayed active (it asked first).
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!active || !router) return;
    if (pendingBack.current !== undefined && key.current) {
      // Closed and opened again in one go (React's development double run): keep the entry.
      clearTimeout(pendingBack.current);
      pendingBack.current = undefined;
    } else {
      const next = `l${++counter}`;
      key.current = next;
      shown.current = false;
      const push = () => {
        // Closed before an earlier step back landed: nothing to push.
        if (key.current !== next) return;
        void router.navigate({
          to: '.',
          search: ((prev: Record<string, unknown>) => prev) as never,
          state: ((prev: Record<string, unknown>) => ({ ...prev, [LAYER]: next })) as never,
          resetScroll: false,
        });
      };
      if (settling) void settling.then(push);
      else push();
    }
    const mine = key.current;
    // Only Back (or Forward, or a jump) takes the entry away: a navigation inside the layer (a
    // filter that replaces the URL) leaves the layer open, and so does a pop before the entry
    // was in place (an earlier layer's step back landing).
    const unsubscribe = router.history.subscribe(({ location, action }) => {
      if (key.current !== mine) return;
      if (layerOf(location.state) === mine) {
        shown.current = true;
        return;
      }
      if (action.type === 'PUSH' || action.type === 'REPLACE' || !shown.current) return;
      key.current = null;
      handler.current();
      setRound((r) => r + 1);
    });
    // The push may have landed before the subscription.
    if (layerOf(router.history.location.state) === mine) shown.current = true;
    return () => {
      unsubscribe();
      pendingBack.current = setTimeout(() => {
        pendingBack.current = undefined;
        if (key.current !== mine) return;
        key.current = null;
        if (layerOf(router.history.location.state) === mine) stepBack(router);
      }, 0);
    };
  }, [active, round, router]);
}

/** A layer's entry is the current one: a link inside it should replace that entry. */
export function isLayerOpen(state: unknown): boolean {
  return layerOf(state) !== undefined;
}
