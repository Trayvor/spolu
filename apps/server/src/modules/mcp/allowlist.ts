import type { SessionUser } from '@spolu/shared';
import { canSeeFinance } from '../finance/policy.js';

/**
 * Every `/api` route the MCP layer may call (spec §2 #6, ADR 0033): deny by default. A route
 * missing here is unreachable from MCP whatever a tool tries (`callApi` throws), so a new route
 * is never exposed by accident. Finance routes are marked `finance` and refused before the
 * route for a user without the finance right. `leaks.test.ts` checks that every entry is a
 * registered route and that every finance and time route is marked.
 *
 * Never add: `/api/me/mcp/*` (a token must not make tokens), auth and session routes, the
 * finance grant (`/api/admins/:id/finance-access`), uploads, deletes.
 */
export type AllowedRoute = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** A finance route: only for finance holders, whatever tool asks (spec §2 #6). */
  finance?: true;
};

export const ALLOWED_ROUTES: readonly AllowedRoute[] = [
  // The global search (2026-10-18): finance is never in it.
  { method: 'GET', path: '/api/search' },
  // People and groups
  { method: 'GET', path: '/api/groups' },
  { method: 'GET', path: '/api/groups/:id' },
  { method: 'GET', path: '/api/groups/:id/people' },
  { method: 'GET', path: '/api/groups/:id/members' },
  { method: 'GET', path: '/api/groups/:id/members/invited' },
  { method: 'GET', path: '/api/groups/:id/members/removed' },
  { method: 'GET', path: '/api/groups/:id/requesters' },
  { method: 'GET', path: '/api/admins' },
  // Chat
  { method: 'GET', path: '/api/groups/:id/chat' },
  { method: 'GET', path: '/api/tasks/:id/chat' },
  { method: 'GET', path: '/api/tickets/:id/chat' },
  { method: 'GET', path: '/api/channels/:id/messages' },
  { method: 'GET', path: '/api/messages/:id/thread' },
  { method: 'GET', path: '/api/chat/unread' },
  { method: 'POST', path: '/api/channels/:id/messages' },
  // Tasks
  { method: 'GET', path: '/api/groups/:id/board' },
  { method: 'GET', path: '/api/groups/:id/board/done' },
  { method: 'GET', path: '/api/groups/:id/board/unseen' },
  { method: 'GET', path: '/api/groups/:id/tasks/search' },
  { method: 'GET', path: '/api/tasks/:id' },
  { method: 'GET', path: '/api/tasks/global' },
  { method: 'GET', path: '/api/me/home/tasks' },
  { method: 'POST', path: '/api/groups/:id/tasks' },
  { method: 'PATCH', path: '/api/tasks/:id' },
  { method: 'POST', path: '/api/tasks/:id/move' },
  // Tickets
  { method: 'GET', path: '/api/groups/:id/tickets' },
  { method: 'GET', path: '/api/tickets/global' },
  { method: 'GET', path: '/api/tickets/:id' },
  { method: 'GET', path: '/api/tickets/:id/assignee-candidates' },
  { method: 'POST', path: '/api/tickets' },
  { method: 'PATCH', path: '/api/tickets/:id' },
  { method: 'PUT', path: '/api/tickets/:id/assignees/:userId' },
  { method: 'DELETE', path: '/api/tickets/:id/assignees/:userId' },
  // Knowledge and meetings
  { method: 'GET', path: '/api/groups/:id/knowledge' },
  { method: 'GET', path: '/api/groups/:id/knowledge/folders' },
  { method: 'GET', path: '/api/knowledge' },
  { method: 'GET', path: '/api/knowledge/:id' },
  { method: 'GET', path: '/api/me/home/meetings' },
  { method: 'POST', path: '/api/groups/:id/knowledge' },
  { method: 'PATCH', path: '/api/knowledge/:id' },
  // Projects and events
  { method: 'GET', path: '/api/groups/:id/projects' },
  { method: 'GET', path: '/api/projects/:id' },
  { method: 'GET', path: '/api/project-events/:id' },
  { method: 'POST', path: '/api/groups/:id/projects' },
  { method: 'PATCH', path: '/api/projects/:id' },
  { method: 'POST', path: '/api/projects/:id/events' },
  { method: 'PATCH', path: '/api/project-events/:id' },
  // Bulk email (read only)
  { method: 'GET', path: '/api/bulk-email/campaigns' },
  { method: 'GET', path: '/api/bulk-email/campaigns/:id' },
  { method: 'GET', path: '/api/bulk-email/campaigns/:id/recipients' },
  // Home: counts, mentions, reminders
  { method: 'GET', path: '/api/me/home/counts' },
  { method: 'GET', path: '/api/me/home/mentions' },
  { method: 'GET', path: '/api/me/home/reminders' },
  // The notification centre (read only; "Mark all as read" and the snooze stay in the app)
  { method: 'GET', path: '/api/me/notifications' },
  // Files (canReadFile; a finance-only file only for finance holders)
  { method: 'GET', path: '/api/files/:id' },
  // Finance (owner decision 2026-10-18: every finance entity, read and write, no deletes).
  // `finance`: refused before the route for anyone without the finance right.
  { method: 'GET', path: '/api/groups/:id/finance/items', finance: true },
  { method: 'POST', path: '/api/groups/:id/finance/items', finance: true },
  { method: 'GET', path: '/api/groups/:id/finance/folders', finance: true },
  { method: 'POST', path: '/api/groups/:id/finance/folders', finance: true },
  { method: 'GET', path: '/api/finance/items/:id', finance: true },
  { method: 'PATCH', path: '/api/finance/items/:id', finance: true },
  { method: 'PATCH', path: '/api/finance/folders/:id', finance: true },
  { method: 'GET', path: '/api/finance/org/items', finance: true },
  { method: 'POST', path: '/api/finance/org/items', finance: true },
  { method: 'GET', path: '/api/finance/org/folders', finance: true },
  { method: 'POST', path: '/api/finance/org/folders', finance: true },
  { method: 'GET', path: '/api/finance/payees', finance: true },
  { method: 'GET', path: '/api/groups/:id/finance/overview', finance: true },
  { method: 'GET', path: '/api/groups/:id/finance/work-log', finance: true },
  { method: 'GET', path: '/api/finance/overview', finance: true },
  { method: 'GET', path: '/api/finance/work-log', finance: true },
  { method: 'POST', path: '/api/finance/time-entries', finance: true },
  { method: 'PATCH', path: '/api/finance/time-entries/:id', finance: true },
  { method: 'GET', path: '/api/finance/rates', finance: true },
  { method: 'POST', path: '/api/finance/rates', finance: true },
  { method: 'GET', path: '/api/finance/contracts', finance: true },
  { method: 'GET', path: '/api/finance/rankings/paid', finance: true },
  { method: 'GET', path: '/api/finance/rankings/hours', finance: true },
  { method: 'GET', path: '/api/tasks/:id/time', finance: true },
  { method: 'PUT', path: '/api/tasks/:id/time/me', finance: true },
  { method: 'GET', path: '/api/tickets/:id/time', finance: true },
  { method: 'PUT', path: '/api/tickets/:id/time/me', finance: true },
];

const compiled = ALLOWED_ROUTES.map((route) => ({
  method: route.method,
  finance: route.finance === true,
  re: new RegExp(`^${route.path.replace(/:[A-Za-z]+/g, '[A-Za-z0-9_-]{1,64}')}$`),
}));

/**
 * Whether a route, named by its registered pattern (`request.routeOptions.url`, e.g.
 * `/api/tasks/:id`), may be called with the method by the user: an exact entry, and a finance
 * route only for a finance holder. The route guard (`guard.ts`) checks this on every internal
 * call, so a static sibling of an entry (`/api/tasks/search` next to `/api/tasks/:id`), which
 * `isAllowedRoute`'s path regex lets through, is refused.
 */
export function isAllowedRoutePattern(
  method: string,
  routeUrl: string | undefined,
  user: SessionUser,
): boolean {
  return ALLOWED_ROUTES.some(
    (route) =>
      route.method === method &&
      route.path === routeUrl &&
      (route.finance !== true || canSeeFinance(user)),
  );
}

/**
 * Whether a concrete path (no query) may be called with the method by the user: allowlisted,
 * and a finance route only for a finance holder. A first check before the call; the route guard
 * then matches the resolved route exactly (`isAllowedRoutePattern`).
 */
export function isAllowedRoute(method: string, path: string, user: SessionUser): boolean {
  return compiled.some(
    (route) =>
      route.method === method && route.re.test(path) && (!route.finance || canSeeFinance(user)),
  );
}
