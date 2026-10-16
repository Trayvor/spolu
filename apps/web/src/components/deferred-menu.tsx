import {
  cloneElement,
  lazy,
  Suspense,
  useState,
  type ComponentType,
  type HTMLAttributes,
  type ReactElement,
} from 'react';

/** What a deferred menu's full component gets: the trigger to wrap (Radix `asChild`). */
export type DeferredMenuProps = { trigger: ReactElement<HTMLAttributes<HTMLElement>> };

/**
 * A header menu whose code loads on first use. The menu library (Radix menu, floating-ui, scroll
 * lock, about 25 kB gzip) is not needed to draw the header, so it stays out of the entry chunk
 * (docs/architecture/performance.md): until the first click the header shows a plain button
 * looking exactly like the menu's trigger. Pointing at it, touching or focusing it starts the
 * download; the click mounts the full menu (`load`), which opens at once (`defaultOpen`) and
 * stays mounted from then on. A chunk that fails to load (offline, new deploy) leaves the plain
 * button: nothing breaks, the menu just does not open.
 */
export function deferredMenu<P extends object>(
  load: () => Promise<ComponentType<P & DeferredMenuProps>>,
) {
  let started: Promise<ComponentType<P & DeferredMenuProps>> | undefined;
  const preload = () => (started ??= load());
  const Full = lazy((): Promise<{ default: ComponentType<P & DeferredMenuProps> }> =>
    preload().then(
      (component) => ({ default: component }),
      () => ({ default: ({ trigger }: DeferredMenuProps) => trigger }),
    ),
  );

  function DeferredMenu(props: P & DeferredMenuProps) {
    const [armed, setArmed] = useState(false);
    if (armed) {
      return (
        <Suspense fallback={props.trigger}>
          <Full {...props} />
        </Suspense>
      );
    }
    const warm = () => void preload();
    // Radix sets these itself once mounted (and a prop on the child would override its values).
    return cloneElement(props.trigger, {
      'aria-haspopup': 'menu',
      'aria-expanded': false,
      onPointerEnter: warm,
      onTouchStart: warm,
      onFocus: warm,
      onClick: () => setArmed(true),
    });
  }
  return DeferredMenu;
}
