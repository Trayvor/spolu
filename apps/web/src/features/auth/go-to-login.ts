import type { AnyRouter } from '@tanstack/react-router';

/**
 * Send the visitor to /login, remembering where they were so login can bring them back.
 * Does nothing when they are already on the login page.
 */
export function redirectToLogin(router: AnyRouter): Promise<void> {
  const { pathname, href } = router.state.location;
  if (pathname === '/login') return Promise.resolve();
  // In place of the page that needs a session, which would only send Back here again.
  return router.navigate({ to: '/login', search: { redirect: href }, replace: true });
}
