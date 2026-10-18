# Notifications

Each user chooses a notification mode per client group (what arrives) and, in their profile, a channel per notification group (how it arrives). The same settings apply to all notifications, including contract reminders for admins.

## Requirements

- **Notification mode per group** (each user sets it only for themselves, for each group):

  | Mode | What arrives |
  |---|---|
  | **All messages** | a notification for every message, plus everything below |
  | **Mentions and replies** | when the user is mentioned (@ or @all), when someone replies in a thread they took part in or quotes their message, and task notifications about them |
  | **Off** | nothing from this group |

  - **The admin group** "eGrant tím" (Phase 34) starts on **All messages** for every admin, before their own all-groups default; the bell changes it as anywhere.
- **Role defaults**: clients start on All messages, admins on Mentions and replies.
  - **The bell**: a bell button next to the group's logo and name in the group header shows the current mode (bell, bell with @, crossed-out bell) and opens a menu with the three modes, each with one line of explanation. It works for everyone, clients included.
  - **Admins** also have the bell on every row of the groups page, and above the list an "All groups:" control with the same three modes (it shows "Mixed" when the groups differ). Choosing there sets the user's default for every group, current and future, and clears their per-group choices, including the All messages mode a group manager gets automatically (see below); a later per-group choice overrides it again. A group without the user's own choice follows that default, else the role default.
  - **Group managers** (see `client-managers.md`): becoming a group's manager sets the admin's mode for that group to All messages, unless they had already chosen a mode for it. This automatic choice is remembered as coming from managing (origin "manager"). Stopping removes it again, so the group falls back to the user's default; a mode the admin chose with the bell (before or after becoming manager) is their own (origin "user") and stays. Choosing a mode under "All groups:" clears every per-group choice, the automatic ones included; becoming manager again sets All messages again. There is no in-app notification or email for becoming a manager. (eGrant's managers webhook does not set managers: it adds client members, who get the ordinary invite or "You were added to <group>" email with eGrant as the sender's name, see `groups.md`.)
- **Notification groups** (brief item C; for all users, on `/settings`, see `profile.md`). Every event belongs to one group, and the user picks its channel: **Email**, **Push**, **Email and push** or **None**.

  | Group | What it covers | Default |
  |---|---|---|
  | **Chat** | group chat messages, mentions and replies | Push |
  | **Task board** | task moves, assignments, deadline and urgent reminders, a task's custom reminders, and task chats | Push |
  | **Ticket board** | ticket events and the ticket chats (Phase 21) | Email and push |
  | **Knowledge base** | Knowledge base reminders, except a meeting's | Push |
  | **Meetings** | new and moved meetings, a meeting's reminders, the AI summary result (2026-10-17) | Push |
  | **Finance** | reminders of contracts and other finance items (Phase 32 part B: `reminder.due` with `subjectKind: 'finance'`; push "Contract ends on <date>", digest "Contract <title> · <client>: ends on <date>" with "Open contract", opening `/groups/<id>/finance?item=<id>`; never the amount. Phase 32 E: an expense's reminder says "Expense due on <date>" (a salary is titled "Salary: <admin>"), digest "Expense <title>: due on <date>" with "Open expense"; an item of the organisation opens `/finance?item=<id>` and its email's topic is "Finance") | Push |

  - **Finance** shows only to finance admins (`visibleCategoriesFor`), and only they can set it. A finance event is delivered only to someone who holds the finance right at delivery time, so a reminder queued before the right was removed reaches nobody (the audience check, `audienceAmong`).
  - Requester-only people do not see Meetings (only Ticket board, as below). A meeting reminder used to follow Knowledge base; since 2026-10-17 it follows Meetings.

  - The groups replaced the two Phase 6 switches (Push, Email); everyone started on the defaults, except users whose email the iOS fallback had turned on (and who kept it on): their chat, task board and knowledge base groups start on Email and push, since that fallback never runs again.
  - A change saves at once. Choosing Push or Email and push while this device is not set up also sets it up (the browser asks for permission).
  - Above the groups the page shows this device while some group uses push: "on", "not set up" (with "Turn on for this device") or "blocked in the browser settings" (with how to unblock it); on an iPhone outside the Home Screen app it shows the install hint instead. Without VAPID keys on the server the page says push is not available, and Push and Email and push cannot be chosen (a group already on Email and push still gets its email).
  - Under the groups one line says what the email is: a summary of unread items, at most every 10 minutes.
  - **No quiet hours, no weekend silence** (owner decision 2026-10-18): notifications and the reminder jobs run every day, at the times below. A per-user snooze is a possible later addition (off by default), not built.
  - **Email is batched** (2026-10-18: one email per person, it was one per client group and one per ticket): one email per user, sent 10 minutes after the first event that qualifies for email, and only for the events still unread then. Every pending event of the person joins it, of every group and ticket. Each place (a group's chat, a ticket, a meeting, a finance item) is one section: a heading with its name (left out when the email has one place), up to 5 newest lines ("Jana: text", "#123 Subject: Jana: text") and its own button ("Open <group>", "Open ticket", "Open meeting"…), at most 10 sections, then "And N more in Help.", in the user's language. The subject says what it holds: the messages of one place "3 new messages – Firma", one change by its own line ("Reminder: Call the bank, Sun 25 Oct, 10:00"), several changes of one place "Ticket #12: 2 updates", several places "5 updates: Ticket #12, Firma and 3 more". Events that arrive within the 10 minutes join the same email. Reading the messages, switching that group away from email or deactivating the user before it is due means no email for them.
  - **Ticket board** events (Phase 21) pass every mode, Off included: a new ticket goes to the people who watch its client's tickets ("Watch tickets", see `tickets.md`); a ticket's own events go to its riešitelia, or to those watchers while it has none (every admin for a ticket without a client), and to its initiator (owner decision 2026-10-17); a new riešiteľ hears `ticket.assigned`; each is an explicit choice, so only the ticket board channel decides. All messages and Mentions and replies change nothing for them, and Off does not silence them (kept as before, on purpose). A ticket without a client notifies every admin, without a client group. A requester-only person (Phase 21: not an admin, no client membership, only `ziadatel` memberships) sees only the Ticket board group on `/settings`, and is in the audience of their groups for ticket events only, never for chat, task or knowledge events.
- Which events arrive, by mode:

  | Event | All messages | Mentions and replies | Off |
  |---|---|---|---|
  | plain message | yes | no | no |
  | mention, @all | yes | yes | no |
  | reply in my thread, quote of my message | yes | yes | no |
  | task moved, assigned, deadline, urgent, overdue, due date changed (2026-10-18) | yes | yes | no |
  | reminder due (Knowledge base, meeting, task) | yes | yes | **yes** |
  | fill in your time (a completed task or resolved ticket, Phase 32) | yes | yes | **yes** |
  | meeting scheduled or moved | yes | no | no |
  | AI summary ready or failed (to the admin who started it) | yes | yes | **yes** |

  A user gets at most one notification per message; the strongest kind wins. The person who caused an event never gets it, and a message already read gets none. Task chat messages follow the task's group mode and link to the task's chat tab; a plain one goes only to the task's people (creator, assignees, people who wrote in that chat or were named in it; owner decision 2026-10-18), everyone else hears it only by a mention.
- **Push on a device** (2026-10-18, UX review N1): a newer notification with the same device tag (a chat, a thread, a task, a ticket) replaces the older card. The replacement makes a sound and vibrates again only for what is addressed to the person or due now: a mention, an assignment, a new ticket, a resolved ticket, a time request, a reminder, a deadline, urgent or overdue reminder, an AI meeting result. Further messages, thread replies, moves and other updates replace the card silently, so five messages in a row alert once. Clicking a notification uses the tab the person is looking at (focused, else visible, else any).
- **Ticket notifications** (Phase 21, part 21.6; who gets which is in `tickets.md`). Every push opens the ticket (`/tickets/<id>`) and shares the device tag `ticket:<id>`, so a newer one replaces the older on the device.

  | Event | Push title | Push text |
  |---|---|---|
  | new ticket | New ticket #123 · <client> | subject |
  | new ticket without client | New ticket #123 without client | subject |
  | riešiteľ added | You were assigned #123 (SK "Ste riešiteľom tiketu #123") | subject |
  | chat message, mention in the ticket chat | #123 <subject> | Jana: text |
  | status change | Ticket #123: status “In progress” (SK "Tiket #123: stav „V riešení“") | subject |
  | resolved (2026-10-18, also to the watchers) | Ticket #123 resolved | subject |
  | other change | Ticket #123: details updated | subject |
  | turned into tasks | Ticket #123: 2 tasks created | subject |

  A chat message of a ticket goes to the people who hear its updates (its riešitelia, or its watchers while it has none, and its initiator) whether it is a reply or not; someone named in the ticket chat who reads it gets the mention; one who is also in that audience gets one notification. `@all` in a ticket chat means that audience. Texts are in Slovak or English by the user's language.
- **Meeting notifications** (2026-10-17, the Meetings group; spec [2026-10-17-dashboard-follows-notifications-design.md](../superpowers/specs/2026-10-17-dashboard-follows-notifications-design.md)). Every push is titled "<meeting title> · <client>", opens the meeting in the group's Knowledge tab and shares the device tag of its reminder; the digest line is "<title>: <text>" with "Open meeting".

  | Event | When | To whom | Push text |
  |---|---|---|---|
  | `meeting.scheduled` | a meeting is created with a start in the future | the group's people (its clients and every admin; admins only for an admins-only meeting), not its author; delivered under All messages only | New meeting: Thu 22 Oct, 10:00 |
  | `meeting.rescheduled` | an edit moves the start (to the future) | the same | Meeting moved to Thu 22 Oct, 10:00 |
  | `meeting.summary_ready` | "Spracovať s AI" ends with a summary | the admin who pressed it, in every mode | The summary from AI is ready |
  | `meeting.summary_failed` | the run failed after its retries | the admin who pressed it, in every mode | AI processing failed |

  A meeting's optional reminder (proposed 15 minutes before it) is its only reminder: there is no automatic "starts soon" on top. A meeting created or moved into the past, and a deleted meeting, notify nobody. Admins who do not manage the client stay on Mentions and replies by default, so scheduling reaches the clients and the client's managers.
- **The dashboard follows these settings** (owner, 2026-10-17): the admin home's Mentions card, the sidebar's unread numbers and the Meetings card show only what the person was, or would be, notified about by their modes and channels (exact rules in `admin-home.md`). The Tickets, My tasks and Upcoming reminders cards show assigned work whatever the settings.
- **Reminders** (`reminder.due`, from a Knowledge base reminder or a task's custom reminder): sent to the reminder's recipients at the set time. They pass every mode, **Off** included, because the person chose to be reminded; the exception covers only explicit recipients, and someone no longer in the group still gets nothing. In the email digest the line is "Reminder: <title>, <time>"; like task events it always counts as unread.
  - A Knowledge base reminder's push reads "<title> · <group>" with "Reminder for Sun 25 Oct, 10:00" (Bratislava time) and opens the item in the group's Knowledge tab.
  - A task reminder's push reads "<task title> · <group>" (the task's current title) with "Reminder for 14:00", or "Reminder for Thu 16 Oct, 14:00" when it arrives more than 5 minutes late, and opens the task panel. It shares the device tag `task:<taskId>` with the automatic task notifications, so a custom reminder at the same moment as a deadline reminder replaces it on the device instead of stacking; both are still recorded and sent. A task in Completed at the time reminds nobody.
- **Time requests** (Phase 32, see `finance.md`, "Time on done"): `task.time_missing` (Task board group) goes once to every admin assignee of a completed task without time, except the admin who completed it (they get the dialog); `ticket.time_missing` (Ticket board group) likewise to the admin riešitelia of a resolved ticket, also of a ticket without a client. A direct request to one person: it passes every mode like a reminder, and the channel the person set for that group decides. The push reads "<task title> · <client>" ("#123 Subject · <client>" for a ticket; no client for a ticket without one) with "Fill in how much time you spent" and opens the task panel (the ticket page) with `?time=1`, which opens the time dialog; the digest line is "<title>: fill in your time" with "Open task" ("Open ticket"). The payload carries the task (ticket) id, title and client, never time or money. No repeat reminders; the dashboard row stays until the time is filled.
- **Task notifications** (they are about the user, so they arrive in All messages and in Mentions and replies):
  - **moved**: a task moved to another bucket notifies its creator and assignees, not the person who moved it ("Moved to the “eGrant review” column");
  - **assigned**: a newly assigned person is notified (also an admin who does not manage the client, assigned by another admin since 2026-10-18: their mode for that client, by default Mentions and replies, lets it through like any assignment);
  - **deadline**: the assignees are reminded 3, 2 and 1 days before the deadline at 09:00 (Europe/Bratislava) while the task is not in Completed ("Due in 3 days", "Due tomorrow");
  - **overdue** (2026-10-18): once, at 09:00 the day after the due date, to the assignees of an open task ("Overdue, was due 17 Oct 2026"); again only if a new due date passes; not for a due date more than 3 days ago;
  - **due date changed** (2026-10-18): to the assignees when someone else changes or removes the due date of an open task ("Due date changed to 31 Oct 2026", "Due date removed");
  - **urgent**: an urgent task reminds its assignees at 08:00, 11:00, 14:00, 17:00 and 20:00 (Europe/Bratislava), every day, weekends included (owner 2026-10-18: no default silence), until it is in Completed or no longer urgent ("Urgent: still open").
- This applies to all notifications, including contract reminders for administrators.
- Web Push (PWA) works on phone and desktop.
- Notifications about replies in threads the user took part in.
- Notifications from the task chat (see `task-board.md`) and from direct messages (see `direct-messages.md`).
- Administrators are notified about new tickets.
- Example of done: a client gets a push about a new message according to their mode, and with email on, an email too.

## Install and enable prompts

The app asks insistently, on purpose (owner request): push only reaches a device that has the app installed (phones) and notifications allowed. One banner at a time sits at the top of every signed-in screen, under the app header. It takes its own space and pushes the page down, so it never covers the composer or any other control:

1. **Install** — on a phone (and on any iPhone or iPad, even one whose Safari poses as a Mac) in the browser, right after login and on every page load or return to the app once 6 hours have passed since "Not now".
   - Android and other Chromium browsers: "Install the Help app" with **Install**, which opens the browser's own install dialog. When the browser offers no install dialog, the card says "Open the browser menu ⋮ → Install app / Add to Home screen" instead.
   - iPhone and iPad: a dark card, "Important: install the Help app to get notifications. On iPhone, notifications only work from the Home Screen app.", with the steps "Tap Share (the Share icon) → Add to Home Screen → Open the Help app from the icon".
2. **Turn on notifications** — in the installed app on a phone, and in a desktop browser, while some notification group is on Push or Email and push, the browser has not been asked yet and this device has no subscription: "Turn on notifications on this device" with **Turn on** (the browser then asks for permission). "Not now" hides it for 6 hours. If turning on fails, the card stays and says "Notifications could not be turned on. Try again." A device where notifications are blocked gets no card; the profile explains how to unblock them. When the browser already allows notifications but the device lost its subscription, the app subscribes again without a card.
3. **iOS too old for app notifications** (below 16.4, or the installed app without push support) — once per device the app adds email to every notification group on Push (it becomes Email and push; Email, Email and push and None stay) and says: "Your iPhone's iOS doesn't support app notifications. We turned on email notifications for you. Update iOS to 16.4 or newer to get notifications on the phone." with **OK**. This happens only once per user: a later change is never undone (the card then says email is off and where to turn it on when no group uses email; when some group already used email and nothing changed, it says email is already on). No install card on such a phone, since installing would not bring notifications.

"Not now" and "OK" are remembered per device in the browser's storage. Where that storage is blocked, the card shows again on the next page load. The 6 hours are checked again whenever the app comes back to the foreground, so an installed app left open in the background still asks.

## Phase

Phase 6 (modes, channels, thread replies, task chat, task moves, deadline and urgent reminders; events recorded by Phases 5, 8 and 9). Phase 18 adds the manager rule and the origin of a group mode. Phase 7 (DM), Phase 12 (admin notification for new tickets) and Phase 15 (contract reminders) use these settings. Brief item C replaced the Push and Email switches with notification groups; Phase 21 (tickets, part 21.6) uses the ticket board group.
