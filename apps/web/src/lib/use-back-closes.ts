import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';

/** The history state key of an open layer (sheet, dialog, menu). */
export const LAYER = 'layer';

let counter = 0;

const layerOf = (state: unknown) => (state as Record<string, unknown> | undefined)?.[LAYER];

/**
 * Back closes the open layer first (a sheet, a dialog, the section menu) instead of leaving the
 * page: while `active`, the layer has a history entry of its own (the same URL, `state.layer`).
 * Back pops it and calls `onBack`, which closes the layer (or asks first; a layer still open
 * after it gets a new entry). A layer closed in the app removes its entry again with one step
 * back, unless the app has navigated meanwhile (a link or a submit inside it: links inside a
 * layer should `replace`, see `isLayerOpen`). Outside a router (unit tests) it does nothing.
 */
export function useBackCloses(active: boolean, onBack: () => void): void {
  const router = useRouter({ warn: false });
  const handler = useRef(onBack);
  useEffect(() => {
    handler.current = onBack;
  });
  const key = useRef<string | null>(null);
  const pendingBack = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped when Back popped the entry but the layer stayed open (it asked first).
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
      void router.navigate({
        to: '.',
        search: ((prev: Record<string, unknown>) => prev) as never,
        state: ((prev: Record<string, unknown>) => ({ ...prev, [LAYER]: next })) as never,
        resetScroll: false,
      });
    }
    const mine = key.current;
    // Only Back (or Forward, or a jump) takes the entry away: a navigation inside the layer (a
    // filter that replaces the URL) leaves the layer open.
    const unsubscribe = router.history.subscribe(({ location, action }) => {
      if (key.current !== mine || action.type === 'PUSH' || action.type === 'REPLACE') return;
      if (layerOf(location.state) === mine) return;
      key.current = null;
      handler.current();
      setRound((r) => r + 1);
    });
    return () => {
      unsubscribe();
      pendingBack.current = setTimeout(() => {
        pendingBack.current = undefined;
        if (key.current !== mine) return;
        key.current = null;
        if (layerOf(router.history.location.state) === mine) router.history.back();
      }, 0);
    };
  }, [active, round, router]);
}

/** A layer's entry is the current one: a link inside it should replace that entry. */
export function isLayerOpen(state: unknown): boolean {
  return layerOf(state) !== undefined;
}
