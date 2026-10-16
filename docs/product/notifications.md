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

## Install and enable prompts

The app asks insistently, on purpose (owner request): push only reaches a device that has the app installed (phones) and notifications allowed. One card at a time sits at the bottom of every signed-in screen:

1. **Install** — on a phone (and on any iPhone or iPad, even one whose Safari poses as a Mac) in the browser, right after login and on every page load or return to the app once 6 hours have passed since "Not now".
   - Android and other Chromium browsers: "Install Spolu as an app" with **Install**, which opens the browser's own install dialog. When the browser offers no install dialog, the card says "Open the browser menu ⋮ → Install app / Add to Home screen" instead.
   - iPhone and iPad: a dark card, "Important: install Spolu to get notifications. On iPhone, notifications only work from the Home Screen app.", with the steps "Tap Share (the Share icon) → Add to Home Screen → Open Spolu from the icon".
2. **Turn on notifications** — in the installed app on a phone, and in a desktop browser, while push is on in the profile, the browser has not been asked yet and this device has no subscription: "Turn on notifications on this device" with **Turn on** (the browser then asks for permission). "Not now" hides it for 6 hours. If turning on fails, the card stays and says "Notifications could not be turned on. Try again." A device where notifications are blocked gets no card; the profile explains how to unblock them. When the browser already allows notifications but the device lost its subscription, the app subscribes again without a card.
3. **iOS too old for app notifications** (below 16.4, or the installed app without push support) — once per device the app turns email notifications on for the user and says: "Your iPhone's iOS doesn't support app notifications. We turned on email notifications for you. Update iOS to 16.4 or newer to get notifications on the phone." with **OK**. This happens only once per user: if the user turns email off later, no device turns it back on (the card then says email is off and where to turn it on; when email was already on, it says so instead of claiming to have turned it on). No install card on such a phone, since installing would not bring notifications.

"Not now" and "OK" are remembered per device in the browser's storage. Where that storage is blocked, the card shows again on the next page load. The 6 hours are checked again whenever the app comes back to the foreground, so an installed app left open in the background still asks.

## Phase

Phase 6 (modes, channels, thread replies, task chat, task moves, deadline and urgent reminders; events recorded by Phases 5, 8 and 9). Phase 7 (DM), Phase 12 (admin notification for new tickets) and Phase 15 (contract reminders) use these settings.
