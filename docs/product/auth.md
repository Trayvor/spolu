# Registration and login

A client joins a group through an invite link and only needs to enter an email. Later logins use a one-time code sent by email; a password is optional. Sessions are long-lived. The superadmin is created automatically and creates other admins by email.

## Requirements

- Registration:
  1. The administrator copies the group's **invite link** and sends it to the client.
  2. The client opens the link, enters an **email**, confirms a one-time code sent to that email, and then lands in the group. Nothing else needs to be filled in.
- Later logins:
  - by a **one-time code sent to email** (default);
  - **optionally** the user can set a password in settings (phase 16).
- The session is long-lived: the user does not have to log in every time.
- Emails are sent through **Elastic Email** (the service already exists).
- The **superadmin** is created automatically on first start. Their email comes from configuration (`SUPERADMIN_EMAIL`).
- The superadmin cannot be deleted or demoted.
- The superadmin creates other admins: enters an email, the person receives an email and logs in with a code.
- Login for admins is by one-time email code through Elastic Email.
- The code has 6 digits, is valid for 5 minutes and allows 3 tries; after 3 wrong tries the user asks for a new code. Asking again replaces the previous code.
- Anyone may ask for a code: an email that has no account (or a removed account) gets the same generic "if this email has an account, we sent a code" answer, but no email is sent. The answer never reveals whether an account exists.
- A removed (disabled) user gets no code and cannot log in, even with a code sent earlier.
- The code email is in Slovak, or in English when the browser prefers English.
- Asking for codes is limited to 3 per minute from one address (in production).

## Phase

Phase 2 (superadmin, email-code login, long-lived session, creating admins). Optional password: Phase 16. Invite-based registration: Phase 3.
