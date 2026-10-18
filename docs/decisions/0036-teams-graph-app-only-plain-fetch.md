# 0036 Microsoft Teams through Graph app-only over plain fetch, calendar events and polling

Date: 2026-10-18
Status: accepted

## Context
The owner wants Teams meetings created from a knowledge meeting ("call") item, the transcript attached to it after the call (also for meetings made in Teams), and a page where anyone with the link adds the meeting to their calendar. Design and research: [spec](../superpowers/specs/2026-10-18-teams-integration-design.md). The technical choices: how Help authenticates to Microsoft, which library talks to Graph, how a meeting is created so its transcript can be read later, and how Help learns that a transcript exists.

## Decision
- **App-only (client credentials), one Entra app**, limited to the security group "Help – Teams organizers" by a Teams application access policy (meetings, transcripts) and Exchange RBAC for Applications (calendars). No delegated sign-in, no refresh tokens. The credential is either a client secret (`TEAMS_CLIENT_SECRET`) or a certificate (`TEAMS_CERT_PATH` + `TEAMS_CERT_THUMBPRINT`): Help signs an RS256 client assertion with `x5t` = the thumbprint using `node:crypto`. Both are supported because the owner has not chosen (owner answer 5).
- **Plain `fetch`, no Graph SDK and no MSAL.** The client-credentials grant is one POST and Help calls six Graph endpoints; `@microsoft/microsoft-graph-client` and `@azure/msal-node` would add dependencies for that. `modules/teams/graph-client.ts` caches the access token in memory only (renewed 5 minutes before expiry, dropped on a 401), retries 429/503 twice after `Retry-After` (at most 10 s), and turns a failure into a `GraphError` with the status and Graph's inner error code only, never the body.
- **Meetings are calendar events** (`POST /users/{organizer}/events`, `isOnlineMeeting`, `teamsForBusiness`), never standalone `onlineMeetings`: Graph cannot read transcripts of an online meeting that has no calendar event, and an event sends real Outlook invitations and has an `iCalUId`. Automatic recording is a `PATCH` of the event's online meeting (`recordAutomatically`), so the app needs `OnlineMeetings.ReadWrite.All`.
- **Polling, no webhook in T1.** A pg-boss job every 5 minutes looks at the connected meetings that are due (`teams_meeting_links.next_poll_at`, partial index): 10 minutes after the start, every 5 minutes until 3 hours after the planned end, hourly up to 3 days. A look lists the transcripts and downloads them only when their set changed, so it is idempotent. Change notifications come in T2.
- **The Teams side is a table of its own module** (`teams_meeting_links`, keyed by the knowledge meeting); the knowledge module owns the transcript and its admins-only flag and exports the functions the teams module calls. The user-facing object stays the knowledge meeting (owner answer 6).
- **Inert without configuration:** with no `TEAMS_*` variable the Graph client, the job and its schedule are not created, and every Teams route answers 404.

## Consequences
- No new dependency. We own the token flow and a small Graph client (about 300 lines), covered by tests with a fake `fetch`; a Graph change may need small edits there.
- A transcript arrives up to 5 minutes after Teams lists it (an hour, after the first 3 hours). Fine for a summary read later; T2's subscriptions cut it to seconds.
- Help can read and write only the calendars and meetings of the organizers group's members; an admin outside it gets `teams_not_organizer`.
- Secrets live only in the server's env file (and the certificate's key in a file there), never in the repo, the image or logs.
