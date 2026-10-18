# Profile and search

The user profile holds name, avatar and language, the notification channel settings and the optional password. Users can search messages inside a group.

## Requirements

- Profile fields: name, avatar, language.
- Optional **password** as an alternative to code login (see `auth.md`).
- Notification channels are set in the profile (see `notifications.md`).
- Message search within a group.
- Example of done: the system is ready for the team's full move from Teams.

## Phase 6: name, email and language

The profile on `/settings` (Phase 6) lets each user change only their own data. Every signed-in user reaches it from the account menu (the initials in the header): "Settings", above "Log out". The page has three sections, in this order: **Profile** (name, email and "Receive mailings"), **Notifications** (this device's push state and a channel per notification group, see `notifications.md`) and **System status**.

- **Name**: saved with "Save" (`PATCH /api/me`); "Saved" appears under the field. An empty name is refused in the page.
- **Email**: shows the current address with "Change", which opens the steps below inline under it ("We sent a code to …", then "Your email address is now …"). Errors appear under the field and keep the step: "The code is wrong or has expired" (`invalid_code`), "This address belongs to another account" (`email_taken`). On success the page's session is refreshed.
  1. The user enters the new address. It is stored lowercase; the current address is refused (`validation_failed`).
  2. A 6-digit code goes to the new address, in the user's stored language. It reuses the login code's rules: valid for 5 minutes, 3 tries. A new request replaces the earlier one. Limits (`rate_limited`): 10 requests a minute and 20 in any 24 hours per user, 5 an hour to one address whoever asks, and 10 code entries a minute per user.
  3. The user enters the code. A wrong, expired or used-up code, or a code for another address, answers `invalid_code`. An address that already belongs to another account answers `email_taken` only now, after the code, so the first step never tells whether an account exists.
  4. The email changes, every existing session stays logged in, and a notice goes to the old address naming the new one. If that notice cannot be queued, the change still succeeds.
- The **superadmin's** email is fixed by `SUPERADMIN_EMAIL`: the superadmin cannot change their email, and no one can change theirs to it (`validation_failed`). The page shows the superadmin no "Change", only a note that the address comes from the server configuration.
- **Receive mailings** (Phase 23.4): a checkbox "Dostávať hromadné e-maily" / "Receive mailings" in the Profile card, under the email, for every signed-in person, ticked by default. Unticking unsubscribes from bulk email, ticking subscribes again (`GET`/`PUT /api/me/bulk-email`); it saves at once with "Saved", and a failed save unticks back with an error line. A hint says login codes and notifications always arrive. See `bulk-email.md`.
- **Language**: `sk` or `en`, stored on the user (`PUT /api/me/language`); emails and pushes to the user, such as the email-change code, the notice and the email digest, use it. The language stays in the header menu, not on the settings page: choosing a language there while signed in stores it, and every sign-in (once per user and page load) stores the language the app is shown in. Both saves are best effort and never block the switch.

## Saved replies (F7)

Since 2026-10-18 admins also see **Saved replies** on `/settings` (after Notifications, before AI access; a lazy chunk with the lazy `snippets` namespace; clients never see it; anchor `#snippets`). The intro says how to insert one (`/` in a chat or ticket message) and that `{{name}}` becomes the name of the person answered.

- **New reply**: Name (up to 80 characters), Text (up to 4000, plain text or the chat's Markdown) and **Share with all admins** ("Other admins can insert it; only you can change it."). "Fill in the name and the text." when one is empty; at most 200 replies per admin ("You have the most saved replies there can be (200)…", `409 snippet_limit`).
- **The list**, by name: the admin's own replies and every shared one, each with its text (three lines) and a "Shared" tag ("Shared by <name>" on another admin's). Only the author has **Edit** (the same form in place, "Save changes") and **Delete** (the inline confirmation "Delete the reply “<name>”?"). Deleting an admin's account deletes their replies.

## AI access (MCP)

Since 2026-10-18 admins see a fourth card on `/settings`, **AI access (MCP)** (after Notifications, before System status; a lazy chunk with the lazy `mcp` namespace; clients never see it). It connects an AI assistant to Help through the MCP server ([guide](../integrations/mcp.md), [spec](../superpowers/specs/2026-10-18-mcp-server-design.md)):

- **New token**: a name (required, up to 60 characters), the access (**Read only**, the default, or **Read and change**, which never deletes anything) and how long it is valid (7, 30, 90 days or 1 year; 90 by default). **Create token** shows the token once in a framed block with **Copy**, the Claude Code command with the token filled in and **Copy command**, and "It will not be shown again"; **Done** closes it. With 10 active tokens the server answers `409 mcp_token_limit` and the card says to revoke one first.
- **Connected assistants** (OAuth, [ADR 0034](../decisions/0034-mcp-oauth-authorization-server.md)): "In Claude, add a custom connector with this address:" and the server's `/mcp` address; then each connection with the client's name, the access and the host it returns to (for example "Read and change, claude.ai"), "Connected …", "Last used …" or "Not used yet", and **Disconnect**, which asks once more ("The assistant loses access at once"). Empty: "No assistant connected yet."
- **Your tokens**: each with its name, access and first characters, "Expires …" (or "Expired …" in red), "Last used …" or "Not used yet", and **Revoke**, which asks once more ("The assistant using this token loses access at once") before it revokes.
- **Recent changes by AI**: the last 50 write calls of the person's tokens: the tool's name, "refused" when the call was refused or failed, the time and the token's name. Never what was written.

### Consent page

`/oauth/authorize` (outside the app shell; without a session to `/login` and back) is where Claude sends an admin to approve a connection: the heading "Claude wants to use Help as you" (the client's own name), "After your answer you return to claude.ai.", that the assistant sees and changes only what the admin can and every change is logged, the access (**Read only** or **Read and change**; only Read only when the client asked for read; preselected as asked), that it can be disconnected in Settings, and **Allow access** / **Deny**. A client or a žiadateľ sees "Only admins can connect an AI assistant to Help."; a link with an unknown client or address "This connection link is not valid…", and the page never leaves the site for it. With 10 connections, "You have 10 connected assistants…" and **Allow access** is disabled. Texts in the lazy `mcp` namespace, all nine languages.

## Phase

Phase 16 (avatar, search, password). Name, email change, language and the notification channel settings ship in Phase 6; brief item C replaced its push and email switches with notification groups.
