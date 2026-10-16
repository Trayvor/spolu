# Notifications

Each user chooses a notification mode per client group (what arrives) and, in their profile, a channel per notification group (how it arrives). The same settings apply to all notifications, including contract reminders for admins.

## Requirements

- **Notification mode per group** (each user sets it only for themselves, for each group):

  | Mode | What arrives |
  |---|---|
  | **All messages** | a notification for every message, plus everything below |
  | **Mentions and replies** | when the user is mentioned (@ or @all), when someone replies in a thread they took part in or quotes their message, and task notifications about them |
  | **Off** | nothing from this group |

  - **Role defaults**: clients start on All messages, admins on Mentions and replies.
  - **The bell**: a bell button next to the group's logo and name in the group header shows the current mode (bell, bell with @, crossed-out bell) and opens a menu with the three modes, each with one line of explanation. It works for everyone, clients included.
  - **Admins** also have the bell on every row of the groups page, and above the list an "All groups:" control with the same three modes (it shows "Mixed" when the groups differ). Choosing there sets the user's default for every group, current and future, and clears their per-group choices, including the All messages mode a group manager gets automatically (see below); a later per-group choice overrides it again. A group without the user's own choice follows that default, else the role default.
  - **Group managers** (see `client-managers.md`): becoming a group's manager sets the admin's mode for that group to All messages, unless they had already chosen a mode for it. This automatic choice is remembered as coming from managing (origin "manager"). Stopping removes it again, so the group falls back to the user's default; a mode the admin chose with the bell (before or after becoming manager) is their own (origin "user") and stays. Choosing a mode under "All groups:" clears every per-group choice, the automatic ones included; becoming manager again sets All messages again.
- **Notification groups** (brief item C; for all users, on `/settings`, see `profile.md`). Every event belongs to one group, and the user picks its channel: **Email**, **Push**, **Email and push** or **None**.

  | Group | What it covers | Default |
  |---|---|---|
  | **Chat** | group chat messages, mentions and replies | Push |
  | **Task board** | task moves, assignments, deadline and urgent reminders, a task's custom reminders, and task chats | Push |
  | **Ticket board** | ticket events (item B, not built yet; the row is shown already) | Email and push |
  | **Knowledge base** | Knowledge base reminders | Push |

  - The groups replaced the two Phase 6 switches (Push, Email); everyone started on the defaults.
  - A change saves at once. Choosing Push or Email and push while this device is not set up also sets it up (the browser asks for permission).
  - Above the groups the page shows this device while some group uses push: "on", "not set up" (with "Turn on for this device") or "blocked in the browser settings" (with how to unblock it); on an iPhone outside the Home Screen app it shows the install hint instead. Without VAPID keys on the server the page says push is not available, and Push and Email and push cannot be chosen (a group already on Email and push still gets its email).
  - Under the groups one line says what the email is: a summary of unread items, at most every 10 minutes.
  - **Email is batched**: one email per user and client group, sent 10 minutes after the first event that qualifies for email, and only if those events are still unread then. It lists up to 5 lines ("Jana: text") with an "Open" button to the group chat, in the user's language. Events that arrive within the 10 minutes join the same email. Reading the messages, switching that group away from email or deactivating the user before it is due means no email for them.
  - **Ticket board** events (item B) pass every mode, Off included: they go to the people who follow or own the ticket, an explicit choice, so only the ticket board channel decides. A ticket event may have no client group (it goes to the recipients its module chose).
- Which events arrive, by mode:

  | Event | All messages | Mentions and replies | Off |
  |---|---|---|---|
  | plain message | yes | no | no |
  | mention, @all | yes | yes | no |
  | reply in my thread, quote of my message | yes | yes | no |
  | task moved, assigned, deadline, urgent | yes | yes | no |
  | reminder due (Knowledge base, task) | yes | yes | **yes** |

  A user gets at most one notification per message; the strongest kind wins. The person who caused an event never gets it, and a message already read gets none. Task chat messages follow the task's group mode and link to the task's chat tab.
- **Reminders** (`reminder.due`, from a Knowledge base reminder or a task's custom reminder): sent to the reminder's recipients at the set time. They pass every mode, **Off** included, because the person chose to be reminded; the exception covers only explicit recipients, and someone no longer in the group still gets nothing. In the email digest the line is "Reminder: <title>, <time>"; like task events it always counts as unread.
  - A Knowledge base reminder's push reads "<title> · <group>" with "Reminder for Sun 25 Oct, 10:00" (Bratislava time) and opens the item in the group's Knowledge tab.
  - A task reminder's push reads "<task title> · <group>" (the task's current title) with "Reminder for 14:00", or "Reminder for Thu 16 Oct, 14:00" when it arrives more than 5 minutes late, and opens the task panel. It shares the device tag `task:<taskId>` with the automatic task notifications, so a custom reminder at the same moment as a deadline reminder replaces it on the device instead of stacking; both are still recorded and sent. A task in Completed at the time reminds nobody.
- **Task notifications** (they are about the user, so they arrive in All messages and in Mentions and replies):
  - **moved**: a task moved to another bucket notifies its creator and assignees, not the person who moved it ("Moved to eGrant review");
  - **assigned**: a newly assigned person is notified;
  - **deadline**: the assignees are reminded 3, 2 and 1 days before the deadline at 09:00 (Europe/Bratislava) while the task is not in Completed ("Deadline in 2 days");
  - **urgent**: an urgent task reminds its assignees at 08:00, 11:00, 14:00, 17:00 and 20:00 (Europe/Bratislava) until it is in Completed or no longer urgent ("Urgent: still open").
- This applies to all notifications, including contract reminders for administrators.
- Web Push (PWA) works on phone and desktop.
- Notifications about replies in threads the user took part in.
- Notifications from the task chat (see `task-board.md`) and from direct messages (see `direct-messages.md`).
- Administrators are notified about new tickets.
- Example of done: a client gets a push about a new message according to their mode, and with email on, an email too.

## Install and enable prompts

The app asks insistently, on purpose (owner request): push only reaches a device that has the app installed (phones) and notifications allowed. One banner at a time sits at the top of every signed-in screen, under the app header. It takes its own space and pushes the page down, so it never covers the composer or any other control:

1. **Install** — on a phone (and on any iPhone or iPad, even one whose Safari poses as a Mac) in the browser, right after login and on every page load or return to the app once 6 hours have passed since "Not now".
   - Android and other Chromium browsers: "Install Spolu as an app" with **Install**, which opens the browser's own install dialog. When the browser offers no install dialog, the card says "Open the browser menu ⋮ → Install app / Add to Home screen" instead.
   - iPhone and iPad: a dark card, "Important: install Spolu to get notifications. On iPhone, notifications only work from the Home Screen app.", with the steps "Tap Share (the Share icon) → Add to Home Screen → Open Spolu from the icon".
2. **Turn on notifications** — in the installed app on a phone, and in a desktop browser, while some notification group is on Push or Email and push, the browser has not been asked yet and this device has no subscription: "Turn on notifications on this device" with **Turn on** (the browser then asks for permission). "Not now" hides it for 6 hours. If turning on fails, the card stays and says "Notifications could not be turned on. Try again." A device where notifications are blocked gets no card; the profile explains how to unblock them. When the browser already allows notifications but the device lost its subscription, the app subscribes again without a card.
3. **iOS too old for app notifications** (below 16.4, or the installed app without push support) — once per device the app adds email to every notification group on Push (it becomes Email and push; Email, Email and push and None stay) and says: "Your iPhone's iOS doesn't support app notifications. We turned on email notifications for you. Update iOS to 16.4 or newer to get notifications on the phone." with **OK**. This happens only once per user: a later change is never undone (the card then says email is off and where to turn it on when no group uses email; when some group already used email and nothing changed, it says email is already on). No install card on such a phone, since installing would not bring notifications.

"Not now" and "OK" are remembered per device in the browser's storage. Where that storage is blocked, the card shows again on the next page load. The 6 hours are checked again whenever the app comes back to the foreground, so an installed app left open in the background still asks.

## Phase

Phase 6 (modes, channels, thread replies, task chat, task moves, deadline and urgent reminders; events recorded by Phases 5, 8 and 9). Phase 18 adds the manager rule and the origin of a group mode. Phase 7 (DM), Phase 12 (admin notification for new tickets) and Phase 15 (contract reminders) use these settings. Brief item C replaced the Push and Email switches with notification groups; item B (tickets) uses the ticket board group.
