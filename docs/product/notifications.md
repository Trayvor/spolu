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
- This applies to all notifications, including contract reminders for administrators.
- Web Push (PWA) works on phone and desktop.
- Notifications about replies in threads the user took part in.
- Notifications from the task chat (see `task-board.md`) and from direct messages (see `direct-messages.md`).
- Administrators are notified about new tickets.
- Example of done: a client gets a push about a new message according to their mode, and with email on, an email too.

## Phase

Phase 6 (modes, channels, thread replies). Phase 7 (DM), Phase 9 (task chat), Phase 12 (admin notification for new tickets) and Phase 15 (contract reminders) use these settings.
