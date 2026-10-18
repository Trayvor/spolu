# 0047 Push notification buttons act through the session API, with no one-time capability

Date: 2026-10-18
Status: accepted

## Context
N6a of the 2026-10-18 UX review asked for buttons on push notifications: "Hotovo" (move the task to done) on a task push, "Zapísať čas" (open the time dialog) on a time request, and "Odpovedať" on chat, ticket chat and mention pushes. Two of them write. A button is handled by the service worker (`notificationclick` with `event.action`), not by a page, so the question is how the service worker proves who is acting.

Options weighed:
- **A one-time capability in the payload** (a signed token per event, as the ticket sign-in link of [ADR 0022](0022-one-click-ticket-sign-in-link.md)). It would work without a session, but the push payload would then be a credential: it sits in the browser's notification store and passes through the push service (encrypted, but still a bearer token outside our origin), it would need a replay store, and it would act for someone whose session may have ended or whose access was revoked since the push was sent. The payload has so far held nothing sensitive, and should stay that way.
- **The session cookie, through the existing API.** A service worker's `fetch` to its own origin carries the session cookie (SameSite=Lax: the request is same-site) and the browser's own `Sec-Fetch-Site: same-origin` and `Origin` headers, which the CSRF guard (`registerCsrfGuard` in `app.ts`) already accepts and no other site can forge. The route's policy functions decide, exactly as for a click in the app.

## Decision
- **No capability; the session.** The buttons call the HTTP API with `credentials: 'same-origin'`. Nothing new is exempt from the CSRF guard, and every check stays on the server. A signed-out user, a revoked membership or a deleted task gets the usual 401/404, and the service worker then opens the item in the app instead (where the person can sign in).
- **The payload carries ids only**, the ones its URL already holds (`PushPayload.actions` in `@spolu/shared`): `{ action: 'done', taskId }`, `{ action: 'time', url }`, `{ action: 'reply', channelId, parentId, url }`, with the title (and the reply field's placeholder) in the recipient's language. Finance, meeting, knowledge and the other ticket pushes get no button; finance pushes still carry no amounts.
- **Which push gets which button** (`pushActions` in `notifications/push-content.ts`; one contextual button, Chromium shows at most two):
  - "Hotovo": `task.assigned`, `task.deadline`, `task.urgent`, `task.overdue`, `task.due_changed` and a task's `reminder.due`.
  - "Zapísať čas": `task.time_missing` and `ticket.time_missing`; it opens the push's own URL (`?time=1`), the time dialog for the admin assignee or riešiteľ. Logging own time is only for them (`canLogOwnTaskTime`), and only the time requests go to exactly those people, so other task and ticket pushes get no time button.
  - "Odpovedať": `chat.message`, `chat.mention`, `chat.thread_reply`, `ticket.message`.
- **"Hotovo" is `POST /api/tasks/:id/done`**, bodyless: the move route's checks (`canUseBoard`, the write rate limit) and its service (`moveTask` to the top of the group's Completed column), with the same events (board, message footer, ticket, meeting, time requests). A task already in Completed stays where it is and nothing is recorded, so a second click (another device, a stale card) is harmless; replay is idempotent by design. When the server asks the actor for time (`askTime`, an admin assignee), the service worker opens the task with `?time=1`.
- **"Odpovedať"**: where the platform gives the typed text (`event.reply`, an action of `type: 'text'`), it is posted to `POST /api/channels/:id/messages` (into the thread when the push was about a reply) with a fresh `clientId`, through `readableChannel` and the chat's send limit. Anywhere else, and when the send fails, the chat opens with `&reply=1&c=<channel>` and its composer (the open thread's, for a reply) takes focus (`useChatSearch().reply`, `Conversation`).
- **Code**: the buttons live in their own static script `apps/web/public/push-actions.js`, loaded by `importScripts` before `push-sw.js` (`vite.config.ts`); `push-sw.js` only asks it for the options and hands it button clicks. It validates the payload's buttons (known kinds, id patterns, same-origin URLs through `safePath`).
- **CSP** ([ADR 0044](0044-enforced-csp-set-by-the-app.md)) needs no change: the script is our own (`script-src 'self'`) and it fetches only this origin (`connect-src 'self'`).

## Consequences
- Platform support, as of 2026-10: buttons show in Chromium browsers (Chrome, Edge, Opera, Samsung Internet; desktop and Android) and in Firefox from 152; Safari (macOS, and iOS/iPadOS home-screen apps) shows none, where a tap opens the item as before. No browser ships the inline reply field by default (Chrome only behind its experimental web platform flag), so "Odpovedať" opens the chat with the composer focused almost everywhere; the inline path is there for when it ships.
- Where a platform shows the notification while the session cookie has expired, "Hotovo" opens the app instead of acting; the person signs in and the task is one click away.
- An inline reply whose send fails opens the composer but does not carry the typed text over.
- A new writing button adds a kind to `PushAction`, a branch in `push-actions.js` and an API route with its normal policy checks; never a token in the payload.
