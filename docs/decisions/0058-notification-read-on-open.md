# 0058 Opening a notification reads it: a per-event read time next to the read mark

Date: 2026-10-19
Status: accepted

## Context
[ADR 0045](0045-notification-centre-from-the-events-table.md) kept the centre's read state as one mark per person (`notification_centre_state.read_at`, "Mark all as read"), with no per-event writes. The owner reported that opening a notification, by a click in the bell's list or on a web push (also its buttons "Hotovo", "Zapísať čas", "Odpovedať"), left it unread: there was nothing that could mark one item, and the push did not even carry its event's id.

## Decision
- **A read time per event** next to the mark: `notification_events.read_at` (migration 0064), set by `POST /api/me/notifications/:id/read` (`markCentreItemRead`, only the signed-in user's own event, 404 otherwise; again is a no-op). An item is unread when it is newer than the person's mark and has no `read_at`. The centre's partial index `notification_events_centre_idx` gains `read_at` as its last key, so the unread count stays an index-only scan.
- **The push carries its event id** (`PushPayload.notificationId`). The service worker (`push-sw.js`) posts the read itself on `notificationclick`, for the card and every button, next to opening or acting: it works when the app was closed and a new window opens, and does not depend on the page surviving a navigation. No `?n=<id>` in the URL.
- **Writes over HTTP, then a signal**: after either read route the server emits `notifications:read` (`{ id }`, null for "Mark all as read") to the person's user room; the bell refetches. The service worker also posts `spolu:notifications-read` to our open tabs after its write, for a tab that fetched the bell just before.

## Consequences
- One indexed update per opened item; "Mark all as read" is still one upsert.
- Opening the subject by other means (the task, ticket or chat itself) does not read its centre items; only opening the notification does.
- A stream of pushes that replaced each other under one tag marks only the event of the card that was clicked.
