# 0035 Server tests capture email in memory; Mailpit for e2e and one SMTP check

Date: 2026-10-18
Status: accepted

## Context
ADR 0006 had the tests read login codes from Mailpit. Every server test that logs in (69 files, 186 helper call sites through `loginAs`) sent a real email over SMTP to the shared dev Mailpit and then polled Mailpit's HTTP API with a 5 s deadline. With several `ci.sh` runs and agents on one laptop, Mailpit and the SMTP hop are slow, and these logins were the likeliest cause of the random 15 s test timeouts that made the local merge gate fail (performance review 2026-10-18, finding T3). Raising the deadline would only hide the cost: each login would still be a network round trip and a poll of a server that every parallel run fills.

## Decision
- **`buildTestApp` gives the app an in-memory email sender by default** (`createCapturingEmailSender`, `apps/server/test/mail.ts`). It stores each message per lowercased recipient (To and Cc) in the test file's own module scope. `latestEmail`, `latestLoginCode`, `emailWithSubject` and `countEmailsTo` read that store; a waiting read wakes as soon as a message is stored, with a 25 s deadline that only bounds a hang.
- **The SMTP path stays tested against Mailpit:** `infra/email/email.test.ts` sends To and Cc through nodemailer and reads them back, and one login test in `modules/auth/auth.test.ts` uses `buildTestApp({ realSmtp: true })` and reads the code from Mailpit (`test/mailpit.ts`, retrying failed requests until a 25 s deadline).
- **Bulk email and e2e are unchanged:** bulk email in server tests still goes over SMTP to Mailpit (or a fake), and e2e runs the production-like server, which sends to Mailpit, and reads codes from it (`e2e/mailpit.ts`).
- No new dependency.

## Consequences
- A server-test login is two in-process requests; no test waits on Mailpit except the SMTP checks.
- The capture tests what the app hands to its `EmailSender`, not nodemailer's MIME encoding; that encoding is covered only by the SMTP checks above and by e2e.
- A test that needs another file's mail cannot see it (the store is per file); none does, and that is the isolation we want.
- Mailpit is still needed for the server suite (the SMTP checks and bulk email), so `docker-compose.dev.yml` keeps starting it.
