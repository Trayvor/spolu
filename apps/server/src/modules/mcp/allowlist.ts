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
 * Nor: sending or cancelling bulk email, rating a ticket, the calendar feed, "Mark all as read"
 * and the snooze. A POST that changes nothing is marked `read` (read-only tokens reach it).
 */
export type AllowedRoute = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** A finance route: only for finance holders, whatever tool asks (spec §2 #6). */
  finance?: true;
  /**
   * A POST that changes nothing in the app (an AI suggestion, a translation, an audience
   * count): a read-only token may send it too (`createApiCaller`). Only on POST entries.
   */
  read?: true;
};

export const ALLOWED_ROUTES: readonly AllowedRoute[] = [
  // The global search (2026-10-18): finance is never in it.
  { method: 'GET', path: '/api/search' },
  { method: 'GET', path: '/api/search/messages' },
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
  { method: 'PATCH', path: '/api/messages/:id' },
  { method: 'PUT', path: '/api/messages/:id/reactions' },
  { method: 'GET', path: '/api/channels/:id/people' },
  { method: 'GET', path: '/api/messages/:id/around' },
  { method: 'GET', path: '/api/groups/:id/task-chats' },
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
  { method: 'POST', path: '/api/groups/:id/tasks/from-ticket' },
  { method: 'POST', path: '/api/groups/:id/tasks/from-message' },
  { method: 'POST', path: '/api/groups/:id/buckets' },
  { method: 'PATCH', path: '/api/buckets/:id' },
  // Tickets
  { method: 'GET', path: '/api/groups/:id/tickets' },
  { method: 'GET', path: '/api/tickets/global' },
  { method: 'GET', path: '/api/tickets/mine' },
  { method: 'GET', path: '/api/tickets/:id' },
  { method: 'GET', path: '/api/tickets/:id/assignee-candidates' },
  { method: 'POST', path: '/api/tickets' },
  { method: 'PATCH', path: '/api/tickets/:id' },
  { method: 'PUT', path: '/api/tickets/:id/assignees/:userId' },
  { method: 'DELETE', path: '/api/tickets/:id/assignees/:userId' },
  { method: 'GET', path: '/api/groups/:id/ticket-areas' },
  { method: 'PUT', path: '/api/groups/:id/ticket-areas' },
  { method: 'PUT', path: '/api/tickets/:id/group' },
  { method: 'PUT', path: '/api/tickets/:id/project' },
  { method: 'GET', path: '/api/groups/:id/ticket-watch' },
  { method: 'PUT', path: '/api/groups/:id/ticket-watch' },
  // Ratings: the admins' reads only; rating itself (`PUT /api/tickets/:id/rating`) never.
  { method: 'GET', path: '/api/tickets/ratings/summary' },
  { method: 'GET', path: '/api/tickets/ratings' },
  // AI (2026-10-21): suggestions and translations that change nothing (`read`); the routes'
  // own rules and AI limits apply.
  { method: 'POST', path: '/api/messages/:id/translate', read: true },
  { method: 'POST', path: '/api/tickets/:id/translate', read: true },
  { method: 'POST', path: '/api/tickets/:id/ai-draft', read: true },
  { method: 'POST', path: '/api/tickets/:id/task-split', read: true },
  { method: 'POST', path: '/api/messages/:id/task-split', read: true },
  // Knowledge and meetings
  { method: 'GET', path: '/api/groups/:id/knowledge' },
  { method: 'GET', path: '/api/groups/:id/knowledge/folders' },
  { method: 'GET', path: '/api/knowledge' },
  { method: 'GET', path: '/api/knowledge/:id' },
  { method: 'GET', path: '/api/me/home/meetings' },
  { method: 'POST', path: '/api/groups/:id/knowledge' },
  { method: 'PATCH', path: '/api/knowledge/:id' },
  // Teams for a knowledge meeting (owner 2026-10-21): creating one sends Outlook invites.
  { method: 'GET', path: '/api/knowledge/:id/teams' },
  { method: 'GET', path: '/api/knowledge/:id/teams/people' },
  { method: 'POST', path: '/api/knowledge/:id/teams/meeting' },
  // Projects and events
  { method: 'GET', path: '/api/groups/:id/projects' },
  { method: 'GET', path: '/api/projects/:id' },
  { method: 'GET', path: '/api/project-events/:id' },
  { method: 'POST', path: '/api/groups/:id/projects' },
  { method: 'PATCH', path: '/api/projects/:id' },
  { method: 'POST', path: '/api/projects/:id/events' },
  { method: 'PATCH', path: '/api/project-events/:id' },
  { method: 'GET', path: '/api/groups/:id/timeline' },
  // Reminders of every subject but finance items (`reminders/routes.ts`): read; tasks and
  // events also set their times there (knowledge sets them with the item).
  { method: 'GET', path: '/api/tasks/:id/reminders' },
  { method: 'PUT', path: '/api/tasks/:id/reminders' },
  { method: 'GET', path: '/api/project-events/:id/reminders' },
  { method: 'PUT', path: '/api/project-events/:id/reminders' },
  { method: 'GET', path: '/api/knowledge/:id/reminders' },
  // Weekly client summaries (read) and the audit log (finance rows only for the right, in SQL).
  { method: 'GET', path: '/api/weekly-summaries' },
  { method: 'GET', path: '/api/weekly-summaries/archive' },
  { method: 'GET', path: '/api/weekly-summaries/groups' },
  { method: 'GET', path: '/api/weekly-summaries/:id' },
  { method: 'GET', path: '/api/me/weekly-summary/reminder' },
  { method: 'GET', path: '/api/audit' },
  // Bulk email: reads, drafts and a test to oneself; never the send to recipients or a cancel.
  { method: 'GET', path: '/api/bulk-email/campaigns' },
  { method: 'GET', path: '/api/bulk-email/campaigns/:id' },
  { method: 'GET', path: '/api/bulk-email/campaigns/:id/recipients' },
  { method: 'POST', path: '/api/bulk-email/audience/count', read: true },
  { method: 'POST', path: '/api/bulk-email/audience/people', read: true },
  { method: 'GET', path: '/api/bulk-email/people' },
  { method: 'GET', path: '/api/bulk-email/sender' },
  { method: 'POST', path: '/api/bulk-email/campaigns' },
  { method: 'PUT', path: '/api/bulk-email/campaigns/:id' },
  { method: 'POST', path: '/api/bulk-email/campaigns/:id/test' },
  // Home: counts, mentions, reminders
  { method: 'GET', path: '/api/me/home/counts' },
  { method: 'GET', path: '/api/me/home/mentions' },
  { method: 'GET', path: '/api/me/home/reminders' },
  // The team workload card: the week's minutes only in a finance holder's answer (the route's).
  { method: 'GET', path: '/api/me/home/workload' },
  // The notification centre (read only; "Mark all as read" and the snooze stay in the app)
  { method: 'GET', path: '/api/me/notifications' },
  // The notification settings (channels per group of events, modes per client).
  { method: 'GET', path: '/api/notifications/preferences' },
  { method: 'PATCH', path: '/api/notifications/preferences' },
  { method: 'GET', path: '/api/notifications/modes' },
  { method: 'PUT', path: '/api/notifications/modes/default' },
  { method: 'PUT', path: '/api/groups/:groupId/notification-mode' },
  // Canned replies and saved views (admins); no deletes.
  { method: 'GET', path: '/api/snippets' },
  { method: 'POST', path: '/api/snippets' },
  { method: 'PATCH', path: '/api/snippets/:id' },
  { method: 'GET', path: '/api/me/saved-views' },
  { method: 'POST', path: '/api/me/saved-views' },
  // A substitution starts here; ending it is a DELETE, left to the app.
  { method: 'PUT', path: '/api/admins/:id/substitution' },
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
  // Salaries and document links (2026-10-21): no delete, no unlink (no MCP tool deletes).
  { method: 'GET', path: '/api/finance/salaries', finance: true },
  { method: 'POST', path: '/api/finance/salaries', finance: true },
  { method: 'GET', path: '/api/finance/salaries/:id', finance: true },
  { method: 'PATCH', path: '/api/finance/salaries/:id', finance: true },
  { method: 'POST', path: '/api/finance/salaries/:id/documents', finance: true },
  { method: 'POST', path: '/api/finance/expenses/:id/documents', finance: true },
  // Contracts v2 (ADR 0066): the contracts a master or a document's contract may be.
  { method: 'GET', path: '/api/finance/contract-choices', finance: true },
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
  read: route.read === true,
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

/**
 * Whether a concrete path is one a read-only token may call: a GET, or a POST entry marked
 * `read` (it changes nothing). `isAllowedRoute` still decides whether it is allowed at all.
 */
export function isReadRoute(method: string, path: string): boolean {
  return method === 'GET' || compiled.some((r) => r.read && r.method === method && r.re.test(path));
}
