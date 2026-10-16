# Registration and login

A client joins a group through an invite link and only needs to enter an email. Later logins use a one-time code sent by email; a password is optional. Sessions are long-lived. The superadmin is created automatically and creates other admins by email.

## Requirements

- Registration:
  1. The administrator copies the group's **invite link** and sends it to the client.
  2. The client opens the link, enters an **email**, confirms a one-time code sent to that email, and then lands in the group. Nothing else needs to be filled in except a name, asked once right after the first login (a client who closes the tab on that step gets it again at the next login).
  3. An email that has no account and did not come through an invite gets the same generic message as before and no code: unknown emails cannot sign up on the login page. Opening an invite with an email that already has an account answers exactly as for a new email. For a client account the invite is remembered and applied when they sign in with the code (a client of another group then belongs to both; the latest invite used wins); an admin or a disabled account is left unchanged, and a disabled account still gets no code.
   4. An admin can also add a person by email on the group's Members tab (`groups.md`). Their invitation email links to `/login?email=<their email>`: the login page starts with that email filled in (kept only when it has an `@` and at most 254 characters) and the person presses "Send code".
- Later logins:
  - by a **one-time code sent to email** (default);
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
- **Changing the email** (Phase 6, see `profile.md`) uses a code of the same kind: 6 digits, sent to the **new** address, valid for 5 minutes, 3 tries, and a new request replaces the old one. Limits: 10 requests a minute and 20 in any 24 hours per user, 5 an hour to one address across all users, 10 code entries a minute per user. The code works only for the signed-in user who asked for it and only for the address it was sent to. Wrong, expired and used-up codes all answer `invalid_code`; a taken address answers `email_taken` only after a correct code. The change keeps existing sessions; the old address gets a notice.

## Phase

Phase 2 (superadmin, email-code login, long-lived session, creating admins). Optional password: Phase 16. Invite-based registration: Phase 3. Email change with a code: Phase 6.
