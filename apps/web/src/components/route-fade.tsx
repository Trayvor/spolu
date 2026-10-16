import type { ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { cn } from '@/lib/utils';

/**
 * Fades its content in (`animate-page-in`, 180 ms, opacity only) whenever the route matched at
 * `level` changes: level 2 is a signed-in screen (root, signed-in layout, screen), level 3 a
 * group's tab. Deeper changes (a task panel opening over its board) keep the content as it is.
 * The key only re-creates this wrapper where the screen below changes anyway.
 */
export function RouteFade({
  level,
  className,
  children,
}: {
  level: number;
  className?: string;
  children: ReactNode;
}) {
  const routeId = useRouterState({ select: (state) => state.matches[level]?.routeId });
  return (
    <div key={routeId} className={cn('animate-page-in', className)}>
      {children}
    </div>
  );
}
