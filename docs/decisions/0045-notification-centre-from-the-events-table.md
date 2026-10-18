# 0045 The notification centre reads `notification_events`, with a delivery verdict and held events

Date: 2026-10-18
Status: accepted

## Context
The UX review (F2, X2, N7) asked for a notification centre: a bell in the header that lists what happened to the person, "Mark all as read", the app icon badge, and a second chance for pushes that were swiped away or never sent. Until now `notification_events` was read only by delivery and the digest: whether an event "notified" someone was decided on the fly (audience, read state, rank, mode, channel, device) and not stored, and an event for someone on Push without a device was marked delivered at insert and lost. The owner also wanted a manual snooze in the bell (no quiet hours).

## Decision
- **No new event store.** The centre lists the person's own rows of `notification_events` (purged after 30 days, as before).
- **Delivery stores its verdict** in a new nullable column `in_centre` (migration 0054): true when the event passed audience, read state, rank and mode (`listedInCentre`), whatever the channel and the device; false otherwise; null until decided. The list and the unread count read the partial index `notification_events_centre_idx` on `(user_id, created_at, id) where in_centre`; the list pages by a `(created_at, id)` cursor kept with its microseconds.
- **Held events (N7).** `recordNotifications` no longer stamps `delivered_at` for Push without a device. The worker decides such an event (it is listed at once) and leaves `delivered_at` null; a second pass of every delivery run releases held events whose person now has a device, or that are older than 24 hours, or all of them when the server has no push. Two partial indexes split the passes (`notification_events_undelivered_idx` for undecided, `notification_events_held_idx` for held), so held rows never slow the first pass.
- **Read mark and snooze per person** in a small table `notification_centre_state` (`read_at`, `snoozed_until`). "Mark all as read" is one upsert; read state is "created after `read_at`", so no per-event writes. A snooze skips pushes only (emails and the centre go on); pushes are not sent later.
- **Rendering at read time** with the push texts (`buildPushPayload`), so the centre needs no new texts on the server and follows renames; access is checked again per item at read time (`canSeeCentreItem`).
- No new dependency.

## Consequences
- Events delivered before the migration are not listed (their verdict is unknown); the centre fills up from the release on.
- An event for someone on Push without a device stays undelivered for up to 24 hours; a person who sets up a device within that time gets those pushes then (a burst on the first install, collapsed by the device tags).
- Delivery now decides every event of a person whose channel is not None, including those with no device; that adds the context queries for them to a batch, which used to skip them.
- The bell refreshes its count every minute while the app is visible and on focus; there is no socket event for it (the delivery worker has no socket server).
