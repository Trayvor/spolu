# Registration and login

A client joins a group through an invite link and only needs to enter an email. Later logins use a one-time code sent by email; a password is optional. Sessions are long-lived. The superadmin is created automatically and creates other admins by email.

## Requirements

- Registration:
  1. The administrator copies the group's **invite link** and sends it to the client.
  2. The client opens the link, enters an **email**, confirms a one-time code sent to that email, and then lands in the group. Nothing else needs to be filled in except a name, asked once right after the first login (a client who closes the tab on that step gets it again at the next login).
  3. An email that has no account and did not come through an invite gets the same generic message as before and no code: unknown emails cannot sign up on the login page. Opening an invite with an email that already has an account answers exactly as for a new email. For a client account the invite is remembered and applied when they sign in with the code (a client of another group then belongs to both; the latest invite used wins); an admin or a disabled account is left unchanged, and a disabled account still gets no code.
   4. An admin can also add a person by email on the group's Members tab (`groups.md`). Their invitation email links to `/login?email=<their email>`: the login page starts with that email filled in (kept only when it has an `@` and at most 254 characters) and the person presses "Send code". The link also carries a signed context (`&invite=`, [ADR 0043](../decisions/0043-signed-invitation-context-in-the-login-link.md)): the login page then says who invited them to which group ("Jana Nováková invited you to Obec Lúky.") and one line on what Help is for, and the name step on `/welcome` repeats both (the line on what Help is for shows there for everyone). A forged or outdated link (the context lasts 30 days from the email), another email, a person no longer in the group, or a deactivated group shows the plain page. An account eGrant added says "eGrant" as the inviter.
- Later logins:
  - by a **one-time code sent to email** (default);
  - for **admins** (and the superadmin) also by a **passkey** (2026-10-18, [ADR 0050](../decisions/0050-admin-passkeys-with-simplewebauthn.md)), an alternative that never replaces the code;
  - **optionally** the user can set a password in settings (phase 16).
- The session is long-lived: the user does not have to log in every time.
- Emails are sent through **Elastic Email** (the service already exists).
- The **superadmin** is created automatically on first start. Their email comes from configuration (`SUPERADMIN_EMAIL`).
- The superadmin cannot be deleted or demoted, and cannot change their email; no one else can change their email to the superadmin's.
- On start the superadmin account is created if missing, or re-enabled if it is already the superadmin. An existing admin or client account with that email is never promoted (the server logs an error instead).
- The superadmin creates other admins: enters an email, the person receives an email and logs in with a code.
- Login for admins is by one-time email code through Elastic Email.
- The code has 6 digits, is valid for 5 minutes and allows 3 tries; after 3 wrong tries the user asks for a new code. Asking again replaces the previous code.
- Anyone may ask for a code: an email that has no account (or a removed account) gets the same generic "if this email has an account, we sent a code" answer, but no email is sent. The answer never reveals whether an account exists.
- A removed (disabled) user gets no code and cannot log in, even with a code sent earlier.
- The code email is in Slovak, or in English when the browser prefers English.
- Asking for codes, and signing in, is limited to 10 per minute from one address (in production; `LOGIN_CODES_PER_MINUTE` changes it), so colleagues in one office can log in together. Guessing a code is limited by the 3 tries per code, not by this limit.
- **One-click link from a ticket email** ([ADR 0022](../decisions/0022-one-click-ticket-sign-in-link.md), see `tickets.md`): the "Ticket created" email signs a žiadateľ in without a code, for 7 days, reusable. Never an admin, a client of a group or a removed user (they get the login page with their email filled in). The session is the same as after a code. Opening it marks the email as verified. Signed in as someone else, that session ends first. Tries are limited to 10 a minute from one address.
- **Passkeys for admins** (2026-10-18, [ADR 0050](../decisions/0050-admin-passkeys-with-simplewebauthn.md)): clients and žiadatelia keep the code login only.
  - **Adding** (Settings → "Kľúče (passkeys)", see `profile.md`): a signed-in admin names the passkey (up to 60 characters) and confirms it with the device (fingerprint, face, PIN or a phone). Within 10 minutes of logging in that is all; later, Help first emails a 6-digit code to the admin's address (5 minutes, 3 tries) and the admin enters it. At most 10 passkeys. Each one added emails the admin "A new passkey was added" with its name and time and "if this wasn't you, delete it", like the MCP token notice.
  - **The list** shows each passkey's name, when it was added and when it was last used ("Not used yet" before the first sign-in); **Delete** asks once more and removes it. The code login keeps working.
  - **Logging in**: `/login` shows "Prihlásiť sa kľúčom (passkey)" under the email form (only in browsers with WebAuthn), and where the browser supports it the saved passkeys also appear in the email field's suggestions (autofill). The passkey must be one the browser keeps for this site (discoverable) and the device must verify the person. The session is the same as after a code (60 days, sliding).
  - A passkey of someone who is no longer an admin, or was removed, does not sign in: the page says "This passkey cannot be used. Log in with an email code." Removing an admin deletes their passkeys. Cancelling the device's dialog shows nothing.
  - Limits: 10 passkey sign-ins and 60 requests for a challenge a minute from one address (in production; `LOGIN_CODES_PER_MINUTE` changes both). A challenge works once and for 5 minutes.
  - Passkeys belong to the domain of `PUBLIC_URL` (help.egrant.sk); after a move to another domain admins add them again.
- **Changing the email** (Phase 6, see `profile.md`) uses a code of the same kind: 6 digits, sent to the **new** address, valid for 5 minutes, 3 tries, and a new request replaces the old one. Limits: 10 requests a minute and 20 in any 24 hours per user, 5 an hour to one address across all users, 10 code entries a minute per user. The code works only for the signed-in user who asked for it and only for the address it was sent to. Wrong, expired and used-up codes all answer `invalid_code`; a taken address answers `email_taken` only after a correct code. The change keeps existing sessions; the old address gets a notice.

## History of changes (audit log, 2026-10-19)

The audit log „História zmien“ ([audit-log.md](audit-log.md)) records adding an admin (`admin.added`), deactivating one (`admin.deactivated`) and, as its consequences with the same author and `cause_id`, the finance right it clears (`finance_access.revoked`, a finance row), the MCP tokens and connections it revokes and the passkeys it deletes. Granting and removing the finance right (`finance_access.granted`/`revoked`) are finance rows: only admins with the right see them. Adding and deleting a passkey (`passkey.added`/`deleted`, with its name) are recorded too. A person's own rename on their profile is a preference and is not recorded (there is no route that renames another admin, so `admin.renamed` is not written in v1). Sign-ins are not recorded.

## Phase

Phase 2 (superadmin, email-code login, long-lived session, creating admins). Optional password: Phase 16. Invite-based registration: Phase 3. Email change with a code: Phase 6. Admin passkeys: 2026-10-18 (outside the numbered phases).
