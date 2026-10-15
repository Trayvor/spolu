# Spolu — Phase 6: Notifications and profile (design)

Date: 2026-10-16 · Status: approved by the owner

Requirements: [notifications](../../product/notifications.md), [profile](../../product/profile.md). Roadmap entry: [Phase 6](../../roadmap.md#phase-6--notifications). Builds on the notification events of [Phase 4](2026-10-15-phase-4-shared-foundation-design.md), recorded by Phases 5, 8 and 9.

Built on branch `phase-6`, cut from `main` at 1c25bc4, **in parallel with Phase 9** (`phase-9`, which is cut from `integration`). Whichever merges second regenerates its migration and merges the group header (Phase 9 adds the Tasks tab count, this phase adds the bell).

## Goal

Recorded notification events reach people: Web Push on desktop and phones (the main channel) and, if the user turns it on, email. Each user picks, per group, what they want to hear about. A profile page lets users change their name and email and turn push and email on or off.

## Owner decisions (2026-10-16)

| question | decision |
|---|---|
| Priority | Push first; it must work in browsers on the web and on phones. |
| Channels | In the profile: push on by default, email off by default; each switch is separate. |
| Profile | Name, email (changed with a code sent to the new address), push on/off, email on/off. |
| Group mode | A bell next to the group's logo and name: **All messages**, **Mentions and replies**, **Off**. Each user sets it only for themselves. |
| Admins | Set their own mode per group on the groups page too, and for all groups at once. |
| Defaults | Clients: All messages. Admins: Mentions and replies. |
| Task notifications | Arrive in All messages and in Mentions and replies (they are about the user), not in Off. |
| Parallel | Built in parallel with Phase 9. |
| Install and enable prompts (2026-10-16) | On a phone browser, right after login: ask to install Spolu as an app, then to turn on notifications. Insistently: again every 6 hours until done. On iPhone say clearly that notifications only work after installing. An iOS too old for web push: tell the user, turn email notifications on automatically and say so. |

## Controller rulings (technical, owner informed)

- **Web Push** uses the standard Push API with VAPID keys and the `web-push` npm package on the server (small, the de-facto library). There is no third-party push service and no Firebase. `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:` address) are new env vars. Without them push is disabled and the profile says so. A script, `pnpm --filter server vapid:generate`, prints a key pair.
- **The PWA**:
  - A web app manifest: name "Spolu", the icons from `public/icons`, `display: standalone`, theme colour from the tokens.
  - A small hand-written service worker, `public/sw.js`. It does not cache anything; it only receives pushes and handles notification clicks. Offline is out of scope.
  - Clicking a notification focuses an open Spolu tab and navigates it to the link, or opens a new one.
- **iPhone and iPad.** Apple allows Web Push only for a site added to the Home Screen (iOS 16.4+). See the install and enable prompts below.
- **Install and enable prompts** (owner, insistent by design). One component, `<AppPrompt>`, mounted in the app shell for signed-in users, decides which single prompt to show, if any:
  1. **Install** — on a phone (touch, < 641 px or a mobile user agent) in a browser, not in standalone mode. A bottom card right after login and on every page load once 6 hours have passed since it was last dismissed. Android/Chromium: "Install Spolu as an app" with an **Install** button that uses the captured `beforeinstallprompt` event (falls back to "menu ⋮ → Install app / Add to Home screen" when the event never fires). iPhone/iPad (iOS 16.4+): a stronger card, "Important: install Spolu to get notifications. On iPhone, notifications only work from the Home Screen app.", with the steps "tap Share → Add to Home Screen → open Spolu from the icon" and a small illustration of the Share icon.
  2. **Enable notifications** — when push is on in the profile, the device supports push, permission is `default` and this device has no subscription: on phones in the installed app and on desktop browsers. A banner "Turn on notifications on this device" with **Turn on** (asks the browser permission inside the click). Dismissed → shown again after 6 hours. Permission `denied` → the profile shows how to unblock it; no banner.
  3. **iOS without web push** — iOS older than 16.4 (from the user agent; also when standalone and `PushManager` is missing). Once per device: the server sets `email_enabled = true` for the user (`POST /api/me/notification-fallback`, idempotent, recorded in `user.email_fallback_at` so it never flips the switch back on after the user turned email off again), and the card says: "Your iPhone's iOS doesn't support app notifications. We turned on email notifications for you. Update iOS to 16.4 or newer to get notifications on the phone." with **OK**.
  Dismissal times live in `localStorage` per device (a missing or blocked storage means the prompt shows again, which is the insistent default). Every prompt is a card with clear text and real buttons (≥ 44 px), no animation beyond a short slide-in that respects reduced motion.
- **Subscriptions** are per device: the `push_subscriptions` table holds `id`, `user_id`, unique `endpoint`, `p256dh`, `auth`, `user_agent`, `created_at` and `last_success_at`.
  - A device subscribes only after the browser grants permission, asked inside a user gesture: the profile switch or the **Turn on** button of the enable prompt above.
  - A push service answering 404/410 deletes the subscription.
  - Logging out removes this device's subscription.
- **Delivery pipeline.**
  - After a module commits events, it sends one pg-boss job `notifications.deliver`. A one-minute cron sweep picks up anything left behind after a crash.
  - The worker locks undelivered events (`FOR UPDATE SKIP LOCKED`, batches of 200), decides each one, sends, and sets `delivered_at`. The same row is never delivered twice.
  - **Decision:**
    1. Look up the recipient's group mode (their row, else their own "all groups" default, else the role default).
    2. Apply the filter (table below).
    3. Skip the event if the recipient has already read the message, because the channel or thread read mark is past it, or if the recipient is the actor.
    4. Then push to every subscription of the user if push is on, and queue email if email is on.

  | kind | All messages | Mentions and replies | Off |
  |---|---|---|---|
  | `chat.message` | yes | no | no |
  | `chat.mention` (also @all) | yes | yes | no |
  | `chat.thread_reply`, quote of my message | yes | yes | no |
  | `task.moved`, `task.assigned`, `task.deadline`, `task.urgent` | yes | yes | no |

  A user gets at most one notification per message. A mention also counts as a `chat.message`, and the strongest kind wins.
- **Task chat** events (Phase 9) carry `taskId` in the payload. They follow the task's group mode and link to the task's chat. The deliverer handles any `channelId`/`taskId` payload, so Phase 9 needs no change here.
- **Push content.**
  - Title: the group name, or "<task title> · <group name>" for task chat and task events.
  - Body: "Jana: first 120 characters of the message as plain text", using the existing plain-text helper. Task events read "Moved to eGrant review", "Deadline in 2 days" or "Urgent: still open".
  - `tag` is the channel or thread, so repeated pushes from one conversation replace each other instead of piling up.
  - The payload has no file contents. It is encrypted end to end by Web Push.
- **Email** is batched, not one email per message. 10 minutes after the first undelivered email-eligible event for a user and group, one email goes out: "3 new messages in <group>", with up to 5 lines of "Jana: text" and a button to open the group. It goes out only if the events are still unread by then. It uses the existing SMTP mailer and the eGrant email layout from login codes, in the user's language.
- **Reminders** are recorded by pg-boss crons in Europe/Bratislava and delivered like any other event:
  - `task.deadline`: daily at 09:00, for tasks due in 3, 2 or 1 days, sent to the assignees, while the task is not in Completed.
  - `task.urgent`: at 08:00, 11:00, 14:00, 17:00 and 20:00, for urgent tasks not in Completed, sent to the assignees.
  - A unique key (task, kind, date or slot) makes each reminder idempotent.
- **Group modes.** The `group_notification_settings` table holds (`user_id`, `group_id`, `mode`), with primary key (user, group). The `user` table gets `default_group_mode` (nullable; null means the role default), `push_enabled` (default true) and `email_enabled` (default false).
  - "All groups at once" on the groups page sets `default_group_mode` and deletes the user's per-group rows, so every group, including future ones, follows it. A per-group change then overrides it again.
- **Bell UI.** A bell button sits next to the group logo and name in the group header. It shows the current mode with three icons: bell, bell with an @, or crossed bell. Clicking it opens a small menu with the three options, each with one line of explanation, and a check on the current one. It works for everyone, clients included.
  - On the admin groups page, each group row has the same bell.
  - Above the list, an "All groups:" control holds the same three options plus "Mixed" when the groups differ.
  - The bell and the menu are one component, used in both places.
- **Profile** lives on `/settings`, the page that exists today. Its sections are Profile, Notifications and System status.
  - **Name**: a text field, saved with "Save".
  - **Email**: shows the current address with "Change".
    1. The user enters the new address.
    2. A 6-digit code goes to that address. It reuses the login-code mailer, its rate limits and its 10-minute expiry.
    3. The user enters the code, and the email changes.
    4. A notice goes to the old address. An address that already belongs to another account answers `email_taken` after the code step, so accounts cannot be probed.
  - **Push**: on/off, plus "This device: on / not set up / blocked in the browser settings", with the iOS hint where needed.
  - **Email notifications**: on/off.
  - Language stays where it is today. Avatar and password stay in Phase 16.

## Error handling

New `ErrorCodes`: `email_taken`, `push_unavailable`, `invalid_subscription`. A push send that fails with anything other than 404/410 is retried by pg-boss up to 3 times. After that the event is marked delivered with a logged error, so one bad device never blocks the queue.

## Testing

- **Server:**
  - Mode filter table, row by row.
  - The defaults by role, plus the "all groups" default overridden by a per-group row.
  - Read messages are skipped; actors never get their own events.
  - One notification per message when a mention and a message coincide.
  - `SKIP LOCKED` with two workers: no double delivery.
  - 410 deletes the subscription.
  - Email batching: one email for 3 messages, none when they were read within 10 minutes.
  - Deadline and urgent crons: right days and slots in Europe/Bratislava, idempotent, nothing for Completed tasks.
  - Email change: code to the new address, wrong or expired code, `email_taken`, notice to the old address.
  - Profile endpoints are limited to the user themselves.
- **Web:**
  - The bell menu: current mode, change, the optimistic update.
  - The groups page: the "All groups" control, including "Mixed".
  - `<AppPrompt>`: install card on Android and iPhone (strong iOS copy), enable banner, 6-hour re-show after dismissal, nothing when installed and subscribed, the iOS < 16.4 fallback calls the server once and shows its notice; the server endpoint is idempotent and respects a later manual opt-out.
  - Profile:
    - name save;
    - the email change flow;
    - the push switch states: granted, default and denied;
    - the iOS hint when not standalone;
- **Service worker:** a unit test of the push and notification-click handlers with mocked `self.registration` and `clients`.
- **E2E:** Chromium with a granted notification permission and a fake push sender (`PUSH_PROVIDER=fake` records sends).
  - A client in mode All gets a push record for an admin's message.
  - In Mentions and replies the client gets none for a plain message, but gets one for an @mention.
  - The profile email switch on: one batched email arrives in Mailpit, with the delay shortened by `EMAIL_BATCH_DELAY_MS` in tests.

## Done when

On the test server, on a desktop browser, an Android phone, and an iPhone with Spolu added to the Home Screen, the following works:
- a client gets a push about a new message according to their group mode;
- with email on, a batched email arrives too;
- moving a task notifies its creator and assignees;
- a deadline reminder arrives;
- the bell and the groups page change modes;
- the profile changes the name and the email.

## Documentation updates in this phase

`product/notifications.md` (the modes are renamed to All messages / Mentions and replies / Off; the role defaults; the email batching), `product/profile.md` (the Phase 6 part), `architecture/data-model.md`, `architecture/overview.md` (the delivery pipeline), `architecture/realtime.md` (nothing changes, but it notes that push is separate), `runbooks/deploy.md` and `deploy/test.env.example` (the VAPID vars), `docs/design/tokens.md` (the bell, the banner, the settings sections), and the glossary (push subscription).

## Out of scope

Notification history inside the app, sounds, the desktop badge count, notifications for direct messages (Phase 7), tickets (Phase 12) and contracts (Phase 15), avatar and password (Phase 16), offline mode.
