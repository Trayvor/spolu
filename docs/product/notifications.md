# Notifications

Each user chooses a notification mode per group and delivery channels in their profile. Push (PWA) is on by default, email is off by default. The same settings apply to all notifications, including contract reminders for admins.

## Requirements

- **Notification mode per group** (each user sets it only for themselves, for each group):

  | Mode | What arrives |
  |---|---|
  | **All messages** | a notification for every message, plus everything below |
  | **Mentions and replies** | when the user is mentioned (@ or @all), when someone replies in a thread they took part in or quotes their message, and task notifications about them |
  | **Off** | nothing from this group |

  - **Role defaults**: clients start on All messages, admins on Mentions and replies.
  - **The bell**: a bell button next to the group's logo and name in the group header shows the current mode (bell, bell with @, crossed-out bell) and opens a menu with the three modes, each with one line of explanation. It works for everyone, clients included.
  - **Admins** also have the bell on every row of the groups page, and above the list an "All groups:" control with the same three modes (it shows "Mixed" when the groups differ). Choosing there sets the user's default for every group, current and future, and clears their per-group choices; a later per-group choice overrides it again. A group without the user's own choice follows that default, else the role default.
- **Delivery channels** (for all users, on `/settings`, see `profile.md`):
  - **Push** (PWA): on by default. Under the switch the page shows this device: "on", "not set up" (with "Turn on for this device") or "blocked in the browser settings" (with how to unblock it); on an iPhone outside the Home Screen app it shows the install hint instead. Turning push on also sets up this device when it is not set up yet. Without VAPID keys on the server the page says push is not available.
  - **Email**: off by default, the user can additionally turn it on ("A summary of unread messages, at most every 10 minutes").
    - Email is batched: one email per user and group, sent 10 minutes after the first event that qualifies for email, and only if those events are still unread then. It lists up to 5 lines ("Jana: text") with an "Open" button to the group chat, in the user's language. Events that arrive within the 10 minutes join the same email. Reading the messages, switching email off or deactivating the user before it is due means no email.
- Which events arrive, by mode:

  | Event | All messages | Mentions and replies | Off |
  |---|---|---|---|
  | plain message | yes | no | no |
  | mention, @all | yes | yes | no |
  | reply in my thread, quote of my message | yes | yes | no |
  | task moved, assigned, deadline, urgent | yes | yes | no |

  A user gets at most one notification per message; the strongest kind wins. The person who caused an event never gets it, and a message already read gets none. Task chat messages follow the task's group mode and link to the task's chat tab.
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
2. **Turn on notifications** — in the installed app on a phone, and in a desktop browser, while push is on in the profile, the browser has not been asked yet and this device has no subscription: "Turn on notifications on this device" with **Turn on** (the browser then asks for permission). "Not now" hides it for 6 hours. If turning on fails, the card stays and says "Notifications could not be turned on. Try again." A device where notifications are blocked gets no card; the profile explains how to unblock them. When the browser already allows notifications but the device lost its subscription, the app subscribes again without a card.
3. **iOS too old for app notifications** (below 16.4, or the installed app without push support) — once per device the app turns email notifications on for the user and says: "Your iPhone's iOS doesn't support app notifications. We turned on email notifications for you. Update iOS to 16.4 or newer to get notifications on the phone." with **OK**. This happens only once per user: if the user turns email off later, no device turns it back on (the card then says email is off and where to turn it on; when email was already on, it says so instead of claiming to have turned it on). No install card on such a phone, since installing would not bring notifications.

"Not now" and "OK" are remembered per device in the browser's storage. Where that storage is blocked, the card shows again on the next page load. The 6 hours are checked again whenever the app comes back to the foreground, so an installed app left open in the background still asks.

## Phase

Phase 6 (modes, channels, thread replies, task chat, task moves, deadline and urgent reminders; events recorded by Phases 5, 8 and 9). Phase 7 (DM), Phase 12 (admin notification for new tickets) and Phase 15 (contract reminders) use these settings.
