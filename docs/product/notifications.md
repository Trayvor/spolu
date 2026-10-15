# Notifications

Each user chooses a notification mode per group and delivery channels in their profile. Push (PWA) is on by default, email is off by default. The same settings apply to all notifications, including contract reminders for admins.

## Requirements

- **Notification mode per group** (each user sets it separately for each group):

  | Mode | What arrives |
  |---|---|
  | **All messages** | a notification for every message |
  | **Mentions only** | only when the user is tagged (@) |
  | **Nothing** | notifications are off |

- **Delivery channels** (for all users, in profile settings):
  - **Push** (PWA): on by default;
  - **Email**: off by default, the user can additionally turn it on.
- Which events arrive, by mode:

  | Event | All messages | Mentions only | Nothing |
  |---|---|---|---|
  | plain message | yes | no | no |
  | mention, @all | yes | yes | no |
  | reply in my thread, quote of my message | yes | yes | no |
  | task moved, assigned, deadline, urgent | yes | yes | no |

  A user gets at most one notification per message; the strongest kind wins. Task chat messages link to the task's chat tab.
- This applies to all notifications, including contract reminders for administrators.
- Web Push (PWA) works on phone and desktop.
- Notifications about replies in threads the user took part in.
- Notifications from the task chat (see `task-board.md`) and from direct messages (see `direct-messages.md`).
- Administrators are notified about new tickets.
- Example of done: a client gets a push about a new message according to their mode, and with email on, an email too.

## Phase

Phase 6 (modes, channels, thread replies, task chat, task moves, deadline and urgent reminders; events recorded by Phases 5, 8 and 9). Phase 7 (DM), Phase 12 (admin notification for new tickets) and Phase 15 (contract reminders) use these settings.
