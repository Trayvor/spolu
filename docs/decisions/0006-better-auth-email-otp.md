# 0006 better-auth with email OTP

Date: 2026-10-15
Status: accepted

## Context
Users log in with an email and a one-time code; passwords come only in a late phase. Hand-written authentication is risky and costly to maintain.

## Decision
- Use better-auth with its email-OTP plugin.
- Sessions are stored in the database and sent in an httpOnly cookie. They are long-lived (about 60 days, sliding).
- Roles (`superadmin | admin | client`) are our own, not part of the library.
- Emails go through an `EmailSender` interface: Elastic Email in every deployed environment, Mailpit in local dev and tests. The SMTP implementation (used for Mailpit) uses nodemailer; the Elastic implementation calls the Elastic Email v4 HTTP API with `fetch`.

## Consequences
- OTP and session handling are not written by hand.
- Tests read login codes from Mailpit, so they never send real mail.
- We depend on the library's data model for users and sessions; role logic and permissions stay ours (see permissions.md).
