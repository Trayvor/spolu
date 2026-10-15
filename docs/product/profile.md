# Profile and search

The user profile holds name, avatar and language, the notification channel settings and the optional password. Users can search messages inside a group.

## Requirements

- Profile fields: name, avatar, language.
- Optional **password** as an alternative to code login (see `auth.md`).
- Notification channels are set in the profile (see `notifications.md`).
- Message search within a group.
- Example of done: the system is ready for the team's full move from Teams.

## Phase 6: name, email and language

The profile on `/settings` (Phase 6) lets each user change only their own data:

- **Name**: saved with "Save" (`PATCH /api/me`).
- **Email**: changed with a code sent to the new address.
  1. The user enters the new address. It is stored lowercase; the current address is refused (`validation_failed`).
  2. A 6-digit code goes to the new address, in the user's stored language. It reuses the login code's rules: valid for 5 minutes, 3 tries, at most 10 requests a minute per user (`rate_limited`). A new request replaces the earlier one.
  3. The user enters the code. A wrong, expired or used-up code, or a code for another address, answers `invalid_code`. An address that already belongs to another account answers `email_taken` only now, after the code, so the first step never tells whether an account exists.
  4. The email changes, every existing session stays logged in, and a notice goes to the old address naming the new one.
- **Language**: `sk` or `en`, stored on the user (`PUT /api/me/language`); emails to the user, such as the email-change code and the notice, use it.

## Phase

Phase 16 (avatar, search, password). Name, email change, language and the notification channel settings (push/email) ship in Phase 6.
