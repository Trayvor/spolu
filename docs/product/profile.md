# Profile and search

The user profile holds name, avatar and language, the notification channel settings and the optional password. Users can search messages inside a group.

## Requirements

- Profile fields: name, avatar, language.
- Optional **password** as an alternative to code login (see `auth.md`).
- Notification channels are set in the profile (see `notifications.md`).
- Message search within a group.
- Example of done: the system is ready for the team's full move from Teams.

## Phase 6: name, email and language

The profile on `/settings` (Phase 6) lets each user change only their own data. Every signed-in user reaches it from the account menu (the initials in the header): "Settings", above "Log out". The page has three sections, in this order: **Profile** (name and email), **Notifications** (this device's push state and a channel per notification group, see `notifications.md`) and **System status**.

- **Name**: saved with "Save" (`PATCH /api/me`); "Saved" appears under the field. An empty name is refused in the page.
- **Email**: shows the current address with "Change", which opens the steps below inline under it ("We sent a code to …", then "Your email address is now …"). Errors appear under the field and keep the step: "The code is wrong or has expired" (`invalid_code`), "This address belongs to another account" (`email_taken`). On success the page's session is refreshed.
  1. The user enters the new address. It is stored lowercase; the current address is refused (`validation_failed`).
  2. A 6-digit code goes to the new address, in the user's stored language. It reuses the login code's rules: valid for 5 minutes, 3 tries. A new request replaces the earlier one. Limits (`rate_limited`): 10 requests a minute and 20 in any 24 hours per user, 5 an hour to one address whoever asks, and 10 code entries a minute per user.
  3. The user enters the code. A wrong, expired or used-up code, or a code for another address, answers `invalid_code`. An address that already belongs to another account answers `email_taken` only now, after the code, so the first step never tells whether an account exists.
  4. The email changes, every existing session stays logged in, and a notice goes to the old address naming the new one. If that notice cannot be queued, the change still succeeds.
- The **superadmin's** email is fixed by `SUPERADMIN_EMAIL`: the superadmin cannot change their email, and no one can change theirs to it (`validation_failed`). The page shows the superadmin no "Change", only a note that the address comes from the server configuration.
- **Language**: `sk` or `en`, stored on the user (`PUT /api/me/language`); emails and pushes to the user, such as the email-change code, the notice and the email digest, use it. The language stays in the header menu, not on the settings page: choosing a language there while signed in stores it, and every sign-in (once per user and page load) stores the language the app is shown in. Both saves are best effort and never block the switch.

## Phase

Phase 16 (avatar, search, password). Name, email change, language and the notification channel settings ship in Phase 6; brief item C replaced its push and email switches with notification groups.
