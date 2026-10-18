import { useEffect, useRef } from 'react';
import { useRouterState } from '@tanstack/react-router';

/**
 * Moves the focus to the page heading (or `<main>` when the screen has none yet) after the
 * signed-in screen changes, so keyboard and screen-reader users start at the new page instead of
 * where the old one was. The screen is the route matched at level 2, like `RouteFade`: a group's
 * tab switch or a task panel opening keeps the focus where it is. Nothing happens on the first
 * render, and a focus already inside `<main>` is left alone.
 */
export function useFocusOnRouteChange(): void {
  const routeId = useRouterState({ select: (state) => state.matches[2]?.routeId });
  const previous = useRef(routeId);
  useEffect(() => {
    if (previous.current === routeId) return;
    previous.current = routeId;
    const main = document.getElementById('main');
    if (!main || main.contains(document.activeElement)) return;
    const heading = main.querySelector<HTMLElement>('h1');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    } else {
      main.focus({ preventScroll: true });
    }
  }, [routeId]);
}
