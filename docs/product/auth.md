# Registration and login

A client joins a group through an invite link and only needs to enter an email. Later logins use a one-time code sent by email; a password is optional. Sessions are long-lived. The superadmin is created automatically and creates other admins by email.

## Requirements

- Registration:
  1. The administrator copies the group's **invite link** and sends it to the client.
  2. The client opens the link, enters an **email** and lands in the group. Nothing else needs to be filled in.
- Later logins:
  - by a **one-time code sent to email** (default);
  - **optionally** the user can set a password in settings (phase 16).
- The session is long-lived: the user does not have to log in every time.
- Emails are sent through **Elastic Email** (the service already exists).
- The **superadmin** is created automatically on first start. Their email comes from configuration (`SUPERADMIN_EMAIL`).
- The superadmin cannot be deleted or demoted.
- The superadmin creates other admins: enters an email, the person receives an email and logs in with a code.
- Login for admins is by one-time email code through Elastic Email.

## Phase

Phase 2 (superadmin, email-code login, long-lived session, creating admins). Optional password: Phase 16. Invite-based registration: Phase 3.
