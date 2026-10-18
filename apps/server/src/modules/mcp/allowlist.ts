/**
 * Every `/api` route the MCP layer may call (spec §2 #6, ADR 0033): deny by default. A route
 * missing here is unreachable from MCP whatever a tool tries (`callApi` throws), so a new
 * route, and above all a new finance route, is never exposed by accident. `leaks.test.ts`
 * checks that every entry is a registered route and that the finance entries are exactly the
 * three document reads.
 *
 * Never add: `/api/me/mcp/*` (a token must not make tokens), any other `/finance` route (the work
 * log, time entries, rates, overviews, contracts table, rankings, expenses), the task and ticket
 * `/time` routes, auth and session routes, deletes.
 */
export type AllowedRoute = { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string };

export const ALLOWED_ROUTES: readonly AllowedRoute[] = [
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
  // Files (canReadFile; a finance-only file only for finance holders)
  { method: 'GET', path: '/api/files/:id' },
  // Finance: documents only, read only (the answers are projected without money)
  { method: 'GET', path: '/api/groups/:id/finance/items' },
  { method: 'GET', path: '/api/groups/:id/finance/folders' },
  { method: 'GET', path: '/api/finance/items/:id' },
];

const compiled = ALLOWED_ROUTES.map((route) => ({
  method: route.method,
  re: new RegExp(`^${route.path.replace(/:[A-Za-z]+/g, '[A-Za-z0-9_-]{1,64}')}$`),
}));

/** Whether a concrete path (no query) may be called with the method. */
export function isAllowedRoute(method: string, path: string): boolean {
  return compiled.some((route) => route.method === method && route.re.test(path));
}
