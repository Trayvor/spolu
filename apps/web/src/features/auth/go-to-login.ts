import type { AnyRouter } from '@tanstack/react-router';

/**
 * Send the visitor to /login, remembering where they were so login can bring them back.
 * Does nothing when they are already on the login page.
 */
export function redirectToLogin(router: AnyRouter): Promise<void> {
  const { pathname, href } = router.state.location;
  if (pathname === '/login') return Promise.resolve();
  return router.navigate({ to: '/login', search: { redirect: href } });
}
