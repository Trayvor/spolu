# 0020 One-click sign-in link in the "Ticket created" email

Date: 2026-10-17
Status: accepted

## Context
The "Ticket created" email to a ticket's initiator (often a person who never used Help before) linked to the code login ([0006](0006-better-auth-email-otp.md)): enter the email, wait for a code, type it. The owner reports that some of these people give up there. He asked for a button that signs them straight into their account and opens the ticket, asking at most for their name.

better-auth's `magic-link` plugin was considered: its tokens are single-use and short-lived and its verify step is a GET with the token in the URL. People open the email twice or on a phone and a computer, and a token in a URL path ends up in request logs, so we wrote a small plugin of our own on better-auth's plugin API instead.

## Decision
- **Only the ticket-created email, only for clients.** `ticketEmailUrl` (`modules/auth/ticket-link.ts`) makes the link only for a user with role `client` who is not deactivated; an admin's email keeps the login page (`/login?redirect=/tickets/<id>&email=<their email>`). The same check runs again when the link is used, so an account that became an admin or was deactivated since is refused.
- **Token**: 32 random bytes, base64url (43 characters). Only its hex SHA-256 is stored, in `ticket_sign_in_links` (user, ticket, `expires_at`, `created_at`, `last_used_at`). Valid **7 days** and **reusable** in that time. Expired rows are deleted by the daily `auth.cleanup-verifications` job. A login-code sign-in is not affected by the links.
- **Token in the URL fragment**: `https://<PUBLIC_URL>/t#<token>`. The fragment never reaches a server, proxy or log. The web page `/t` reads it, posts it once to `POST /api/auth/ticket-link/sign-in` `{ token }`, and replaces itself in the history. The server logs only the first 12 hex characters of the token's hash.
- **A better-auth plugin endpoint** (`ticketLinkPlugin`), added to the allow-list of forwarded auth endpoints. It creates the session with `internalAdapter.createSession` and `setSessionCookie`, as the email-code sign-in does, so the cookie, the 60-day sliding life and the `session.create.before` hooks (deactivated check, pending invite) are the same. An unverified email is promoted with the library's `revokeUnprovenAccountAccess` (it marks the email verified: opening the link proves the inbox). The link grants nothing beyond an ordinary session of that user.
- **Answers**: `200 { ticketId }`; refused (unknown, expired, an admin's, a deactivated user's) `400 { code: 'TICKET_LINK_INVALID' }`, with `email` when the link was real and its user is not deactivated, to fill in the login page, which says "The link has expired, sign in with your email". `429 rate_limited` after `LOGIN_CODES_PER_MINUTE` (10) tries a minute from one address (in memory, [0005](0005-single-process-deployment.md)). better-auth's Origin check applies as on every auth POST.
- **Someone already signed in**: the same user keeps the session (nothing new is made); another user's session is deleted first and its sockets disconnected.
- The email's job is deleted a minute after it is sent (`deleteAfterSeconds: 60`) instead of pg-boss's default, as its payload holds the link.

## Consequences
- An initiator reaches their ticket in one click; with an empty name, the existing welcome step asks for it first.
- Anyone who gets the email (forwarded, a shared mailbox) can sign in as that client for 7 days. This is the price of skipping the code, and it is why admins never get a link and the email says not to forward it. A client of a whole group (not only a žiadateľ) gets the same link and reaches the whole group with it.
- Other requester emails (ticket notifications, digests) still go through the code login; they could reuse `ticketEmailUrl` later.
