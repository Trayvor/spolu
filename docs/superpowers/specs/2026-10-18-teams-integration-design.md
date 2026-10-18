# Microsoft Teams integration (design)

Status: **draft for the owner** (2026-10-18). Docs only, no product code yet. The decisions below are ours, made autonomously; each is open to the owner's veto and the ones that most need the owner are repeated under [Open questions](#open-questions-for-the-owner). Researched against Microsoft's documentation as of 2026-10-18 (Graph v1.0); every claim about Microsoft links to its source in [Sources](#sources).

## Owner request (2026-10-18, translated)

1. After a Teams call ends, automatically attach its transcript to the call's record in the knowledge base, when the record can be found by some identifier. This must also work for calls that were created manually in Teams, not through Help.
2. Create a Teams meeting directly from the platform, from a knowledge meeting record. Everyone who follows the link can add it to their own calendar.
3. Suggest a tighter integration where sensible.

It builds on Phase 30 (knowledge meetings: [product](../../product/knowledge-base.md#meetings-phase-30-built), [spec](2026-10-17-knowledge-meetings-design.md)): a meeting record already has a meeting link, a transcript field (pasted or read from `.vtt`), "Spracovať s AI" (summary, decisions, action items) and "Create tasks". This integration fills the transcript automatically and creates the Teams meeting; everything after the transcript is Phase 30, unchanged.

## Summary of the recommendation

- **One Entra app registration** in eGrant's Microsoft 365 tenant, **app-only** (client credentials), so Help can act without anyone being signed in to Microsoft. Its reach is limited to a security group **"Help – Teams organizers"** (the eGrant admins who organise client calls): a Teams **application access policy** granted to that group for meetings and transcripts, and an Exchange **RBAC for Applications** scope on that group for calendars.
- **Create meetings as calendar events** (`POST /users/{organizer}/events` with `isOnlineMeeting: true`, `onlineMeetingProvider: "teamsForBusiness"`), **not** with `POST /onlineMeetings`. Microsoft states that transcripts cannot be read for a standalone `onlineMeeting` that is not on a calendar; an event also sends real Outlook invitations, shows in the organizer's calendar and has an `iCalUId`.
- **Store on the record** the Graph `onlineMeeting` id plus the organizer's Entra object id (both are needed for every later call), the join URL, and for Help-made meetings the event id and `iCalUId`.
- **Manually created meetings:** an admin pastes the Teams link into the record (the field exists) and presses **"Connect to Teams"**; Help resolves the link to the `onlineMeeting` with `GET /users/{organizer}/onlineMeetings?$filter=JoinWebUrl eq '…'` (or by `joinMeetingId` for the new short links), trying the organizers of the group.
- **Transcripts, MVP: targeted polling**, no webhook: for each connected record a job lists `…/onlineMeetings/{id}/transcripts` from the start time on (every 5 minutes for the first 3 hours after the planned end, then hourly up to 3 days), downloads `/content` as WebVTT and stores it through the knowledge service. **Phase 2:** change notifications per organizer (`users/{id}/onlineMeetings/getAllTranscripts`, without resource data, so no encryption certificate) cut the delay to seconds; the poll stays as a safety net.
- **Add to calendar for anyone with the link:** a public page `/m/<token>` with "Join in Teams", "Add to Outlook", "Add to Google Calendar" and "Download .ics"; the `.ics` carries the event's `iCalUId` as its `UID`, so a person who also got the Outlook invitation does not get a second event. Graph invitations go to the people the admin ticks (the group's clients by default).
- **No extra Microsoft cost:** Microsoft stopped metering the Teams APIs on 2025-08-25 (no Azure subscription or billing setup), transcription is part of the standard Microsoft 365 business licences with Teams, and nothing here needs Teams Premium. Two tenant switches are **off by default** and must be turned on: Graph access to transcripts and speaker attribution.

## What Microsoft offers (research)

### Creating a meeting: `onlineMeetings` versus a calendar event

| | `POST /users/{id}/onlineMeetings` | `POST /users/{id}/events` with `isOnlineMeeting` |
|---|---|---|
| Join link | `joinWebUrl` | `onlineMeeting.joinUrl` |
| In the organizer's calendar | **no** ("meetings created via this API aren't shown on the user's calendar") | yes |
| Invitations to attendees | none | yes: "When you create an event that includes attendees, the server sends invitations to all attendees" (cannot be switched off) |
| `iCalUId` | none | yes |
| Transcripts readable later | **no**: the transcript APIs "don't support meetings created using the create onlineMeeting API that aren't associated with an event on the user's calendar"; Microsoft says to use Create event "to be able to retrieve meeting transcripts" | yes |
| Application permission | `OnlineMeetings.ReadWrite.All` + application access policy | `Calendars.ReadWrite` (Exchange; scoped with RBAC for Applications) |
| Changing it | `PATCH onlineMeeting` | `PATCH event` (Outlook sends updates); the provider cannot be changed and online cannot be turned off afterwards |

**Decision 1:** calendar events. The meeting's `onlineMeeting` id is then found from the event's join URL (below), which needs `OnlineMeetings.Read.All` and the application access policy.

**Delegated versus application permissions.** Delegated (each admin signs in to Microsoft once and Help keeps their refresh token) is the most natural "Help acts as me", but `getAllTranscripts` and the tenant-wide subscriptions are application-only, and keeping one refresh token per admin is more secret material to protect and renew. **Decision 2:** application permissions only, held in check by the application access policy (meetings, transcripts) and Exchange RBAC for Applications (calendars), both limited to one security group. The organizer of a meeting made from Help is the admin who pressed the button (their Microsoft account, found by email).

**The Teams application access policy.** App-only access to online meetings and their artifacts (`OnlineMeetings.Read.All`, `OnlineMeetings.ReadWrite.All`, `OnlineMeetingArtifact.Read.All`, `OnlineMeetingTranscript.Read.All`, `OnlineMeetingRecording.Read.All`) works only "on behalf of" users who have been granted an application access policy listing the app (`New-CsApplicationAccessPolicy -Identity … -AppIds …`, then `Grant-CsApplicationAccessPolicy -PolicyName … -Identity <user object id>`, `-Group <group id>` or `-Global`). Without it Graph answers `403 "No application access policy found for this app"`. Changes take up to 30 minutes. A user has at most one such policy (a new one replaces the old). **Decision 3:** grant it to the security group "Help – Teams organizers", never `-Global`.

**Calendar scope.** `Calendars.ReadWrite` consented in Entra is tenant-wide. Exchange Online's **RBAC for Applications** grants the same right (`Application Calendars.ReadWrite`) only for a management scope, e.g. the members of a group; it replaces Exchange's older application access policies. The Entra consent for `Calendars.ReadWrite` must then **not** be given, because the two grants add up and the unscoped one would win. Only direct group members count (no nested groups). Cache: 30 minutes to 2 hours after a change.

### Transcripts

- **List and read:** `GET /users/{organizerId}/onlineMeetings/{meetingId}/transcripts` (callTranscript: `id`, `meetingId`, `callId`, `createdDateTime`, `endDateTime`, `meetingOrganizer`), then `…/transcripts/{transcriptId}/content`. Content formats: `text/vtt` (default, WebVTT with `<v Speaker>` voice tags) or `application/vnd.microsoft.graph.transcript+text` (no speaker names, chosen with the `Accept` header). Application permission `OnlineMeetingTranscript.Read.All` plus the application access policy for the organizer. Works only while the meeting has not expired (60 days after a one-time meeting's time, extended by 60 days when it is joined or updated).
- **Recordings:** `OnlineMeetingRecording.Read.All`, the same pattern (`…/recordings`, `/content`). Not needed for the MVP (we need text, not video); see idea 8 below.
- **Tenant switches (new in 2026, both off by default):** "By default, Microsoft Graph access is off, so agents and apps can't access meeting transcripts, regardless of app-level permissions." Turned on in Teams admin center > Meetings > Meeting settings > **Transcript API access** (or `Set-CsTeamsMeetingConfiguration -EnableGraphTranscriptAccess true -EnableAttributedTranscripts true -Identity Global`). With access off every transcript call and every transcript subscription answers `403` with inner code `GraphAccessToTranscriptsDisabled`; with speaker attribution off, `text/vtt` answers `403 SpeakerAttributionNotAllowed` and only the unattributed format works.
- **`getAllTranscripts` and delta:** `GET /users/{id}/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='{id}',startDateTime=…,endDateTime=…)` lists the transcripts of every scheduled meeting a user organised (application permission only, not channel meetings), and `delta` on it returns only new ones since the last call. Useful for finding meetings Help does not know yet (idea 1).
- **Change notifications** (`POST /subscriptions`, `changeType: created`):
  - per meeting: `communications/onlineMeetings/{onlineMeetingId}/transcripts`;
  - per organizer: `users/{userId}/onlineMeetings/getAllTranscripts`;
  - tenant-wide: `communications/onlineMeetings/getAllTranscripts` (every meeting of the tenant).
  - All support scheduled meetings, not private channel meetings. "The notification for a transcript is sent only if the subscription happens before the transcription starts."
  - **Lifetime:** at most 4,320 minutes (3 days) for callTranscript; requests under 45 minutes are raised to 45. Over 1 hour **requires `lifecycleNotificationUrl`** (Teams resources), which receives `reauthorizationRequired`, `subscriptionRemoved` and `missed`. Renew with `PATCH /subscriptions/{id}`.
  - **Validation:** on create (and for the lifecycle URL) Graph POSTs `?validationToken=…`; answer `200`, `text/plain`, the decoded token, within 10 seconds. Each notification carries the subscription's secret `clientState` (required, ≤ 128 characters), to compare. Answer every notification `2xx` within 3 seconds (queue it, `202`), otherwise retries for up to 4 hours and, for slow endpoints, throttling and dropped notifications.
  - **Encryption certificate:** needed only with `includeResourceData: true` (the payload then carries the transcript metadata encrypted, plus `validationTokens` JWTs). "Subscriptions for notifications without resource data don't require an encryption certificate." Without resource data the notification has the `resource` path (`users/{organizer}/onlineMeetings('…')/transcripts('…')`), which is all we need: we fetch the transcript ourselves anyway.
  - **Latency:** callTranscript notifications on average under 10 seconds, at most 60 minutes.
- **Metered?** No. Microsoft's metered-API list: "Starting August 25, 2025, the Teams APIs are no longer metered, and no billing configuration is required to use these APIs." The only metered API left there is SharePoint's `assignSensitivityLabel`. Transcript and recording APIs, `getAllTranscripts` and their change notifications are free of Graph charges and need no Azure subscription.
- **callRecords** (`CallRecords.Read.All`, a record per finished call or meeting, kept 30 days, notification latency on average under 30 minutes and up to 150) tell that a meeting ended and who joined, but carry no transcript; they would add a second, broad permission for little gain. **Not used.**

**Decision 4:** MVP polls the transcripts of connected meetings; Phase 2 adds per-organizer subscriptions. Polling is simple (no public webhook, no 3-day renewals, no lifecycle endpoint), touches only the meetings Help knows, and its delay (≤ 5 minutes for 3 hours after the planned end) is fine for a summary read later. The per-organizer subscription (not tenant-wide) keeps notifications to the policy group's meetings. Neither uses resource data, so no encryption certificate.

### Must transcription be started by hand?

Yes, by default someone in the meeting presses Record or Start transcription; no transcription means no transcript to attach. The options:

1. **Meeting policy "Transcription"** (Teams admin center > Meetings > Meeting policies; `Set-CsTeamsMeetingPolicy -AllowTranscription $true`): on by default for new policies; it only *allows* transcribing. Both the organizer and the person starting it need it on.
2. **"Record and transcribe automatically"** meeting option: offered to organizers whose meeting policy has `-AutoRecording Enabled`; off per meeting by default; when on, recording and transcription start without anyone pressing anything. Graph exposes it as `onlineMeeting.recordAutomatically` (updatable with `PATCH /users/{id}/onlineMeetings/{id}`, needs `OnlineMeetings.ReadWrite.All`). `allowTranscription` (also updatable, applies to a running meeting) only allows it. This is **not** a Teams Premium feature.
3. **Teams Premium meeting templates** can enforce automatic recording and transcription with a locked setting ("Only organizers with a Teams Premium license can use assigned meeting templates").

**Decision 5:** no Premium. The setup turns on `AllowTranscription` and `AutoRecording Enabled` for the policy group; in Phase 2 the "Create Teams meeting" dialog gets a checkbox **"Record and transcribe automatically"** (default off; see open question 3) that sets `recordAutomatically` after creating the event. Note that it also records video into the organizer's OneDrive. Until then the organizer starts transcription in the meeting, and Help says so in the dialog ("Start transcription in Teams, Help picks it up after the call").

### Finding a meeting created manually in Teams or Outlook

The `onlineMeeting` id can be looked up only through a user (`/users/{userId}/…`, the organizer or an invited attendee from our tenant, and that user needs the application access policy):

- **By join URL** (works for meetings made in the Teams client, as Microsoft notes): `GET /users/{userId}/onlineMeetings?$filter=JoinWebUrl eq '{url-encoded joinWebUrl}'` returns a collection with one meeting.
- **By the meeting ID** (the digits in a meeting's "Meeting ID"): `GET /users/{userId}/onlineMeetings?$filter=joinMeetingIdSettings/joinMeetingId eq '{id}'`. Needed for the **new short links** `https://teams.microsoft.com/meet/<digits>?p=<passcode>` that Teams puts in invitations of meetings scheduled since January 2026: they hold the meeting ID but no organizer.
- **The classic link** `https://teams.microsoft.com/l/meetup-join/19:meeting_…@thread.v2/0?context={"Tid":"…","Oid":"…"}` holds the tenant (`Tid`) and the organizer's object id (`Oid`). Microsoft warns that the URL format may change and should not be relied on; we use `Tid` and `Oid` **only as hints** for which user to ask, never as proof.
- **By the calendar event's `iCalUId`** or **by organizer and time window** (`calendarView`): needs read access to calendars; useful for idea 1 (records from the calendar), not for a pasted link.

**Resolution order** for a pasted link: (1) if the link has a `Tid` that is not eGrant's tenant, stop with "organised outside eGrant"; (2) candidate users: the `Oid` from the link if it is a known organizer, then every organizer of the group's managers, then every other known organizer (the policy group is a handful of people, so at most a few calls); (3) for each, the `JoinWebUrl` filter, then the `joinMeetingId` filter when the link has one; (4) the first hit gives `id`, organizer (`participants.organizer.identity.user.id`), `joinWebUrl`, start and end. The organizer from Graph is stored, not the hint.

**What the record stores** (decision 6): the `onlineMeeting` **id** and the **organizer's Entra object id** (every transcript call needs both); the `joinWebUrl` as Graph returns it (to detect a changed link field); for Help-made meetings also the **event id** and **`iCalUId`**. The record's existing "meeting link" stays what the user sees.

### "Add to calendar" for anyone with the link

- **Graph invitations** reach only the people listed as attendees when the event is created (or added later). Good for the group's clients and colleagues: a real Outlook/Exchange invitation from the organizer's mailbox, with RSVP and updates on change.
- **Everyone else** (a client forwards the link to a colleague): Help serves a public page and a file:
  - an `.ics` file (iCalendar, RFC 5545) with `UID` = the event's `iCalUId`, `SEQUENCE` bumped on each change, `DTSTART`/`DTEND` in UTC, `SUMMARY`, `LOCATION` = the join URL, `DESCRIPTION` with the join URL, `URL`; opening it adds the event in Outlook, Apple Calendar or Google;
  - an "Add to Outlook" link (`https://outlook.office.com/calendar/0/deeplink/compose?subject=…&startdt=…&enddt=…&body=…&location=…`; `outlook.live.com` for personal accounts) and an "Add to Google Calendar" link (`https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=…/…&details=…&location=…`). Both are the providers' public compose links; neither notifies the organizer, and the event they create is the viewer's own copy (no updates).

**Decision 7:** both. The dialog lists the people to invite (the group's clients and its managers ticked, more emails can be typed); the record shows "Share invitation link" with the public page.

## Product design

### Meeting record (knowledge item of type Meeting)

New block **Teams** in the meeting detail, admins only (clients see only the join pill as today):

- No Teams meeting yet, record has no Teams link: **"Create Teams meeting"** (admins who can edit the item). Dialog: title and time from the record (editable there, not here), duration (default 60 minutes), organizer (the signed-in admin; a different organizer from the policy group can be chosen), invitees (the group's active clients and managers with their emails, ticked; extra emails), "Send Outlook invitations" (on), the note about starting transcription. On success the record's meeting link is set to the join URL and the block shows the state.
- The record has a Teams link that is not connected: **"Connect to Teams"** (admins). States: resolving, connected, "Not found among eGrant organizers", "Organised outside eGrant (transcript cannot be fetched; paste or upload it)", "Teams is not set up".
- Connected: organizer, "Transcript: waiting after the meeting / imported <time> / none found (no one started transcription)" with **"Check now"**, "Disconnect", and **"Share invitation link"** (copy the public link) for Help-made meetings.
- Editing the record's time or title of a Help-made meeting asks "Update the Teams meeting and notify invitees too?" (Phase 2; MVP shows "Change it in Outlook as well" instead). Deleting the record asks whether to cancel the Teams meeting (Phase 2; MVP deletes only the record and says the meeting stays in Outlook).

### Transcript import

- When transcripts appear for the meeting, the job keeps those whose `createdDateTime` lies in the record's window (from 1 hour before `startsAt` to 12 hours after; this matters for **recurring series**, which share one `onlineMeeting` and list the transcripts of every occurrence), orders them by time (a meeting where transcription was stopped and restarted has several), downloads each as `text/vtt` (falling back to the unattributed format on `403 SpeakerAttributionNotAllowed`), converts VTT to text with the Phase 30 parser (speaker kept as "Name: "), joins them with a blank line and hands the text to the knowledge module (`attachMeetingTranscript(itemId, text, { source: 'teams' })`), which stores it with `transcript_source = 'teams'`, bumps `updated_at` and sends `knowledge:item`.
- An existing transcript is never overwritten: the block shows "A Teams transcript is available" with **"Replace with the Teams transcript"**. The record's transcript link is set to nothing (the Teams transcript lives in the meeting's chat; we keep our copy).
- The admins who can process the meeting get one notification "Transcript of <title> is ready" (the Meetings notification group; a new event kind `meeting_transcript_ready`), with the existing "Spracovať s AI" one click away.
- **Visibility (decision 8):** the transcript follows the item's visibility as in Phase 30, **but** a transcript imported from Teams is held **admins-only until an admin presses "Share transcript with the client"** (a per-meeting flag). A client call may contain internal remarks after the client left; an automatic import must not publish them. Manual pastes keep today's rule. Open question 2.

### Public "add to calendar" page

`/m/<token>` (no sign-in, `noindex`, minimal lazy route): title, date and time in the viewer's time zone (Bratislava shown too), organizer name, **Join in Teams**, **Add to Outlook**, **Add to Google Calendar**, **Download .ics**, in the viewer's browser language among the nine. Nothing else from the record (no notes, transcript, client name unless in the title). `GET /api/public/meetings/:token` (JSON) and `GET /api/public/meetings/:token/invite.ics`. Token: 128 random bits, base64url, stored hashed; "Stop sharing" revokes it (a new share makes a new token). 60 requests a minute per IP. Only for Help-made meetings in the MVP (a connected manual meeting has no event to mirror; Phase 2 may allow it with the times from Graph).

## Architecture

### Module `modules/teams` (server) and `features/teams` (web)

Built with the `new-module` skill; the same pattern as the other modules.

- `graph-client.ts`: plain `fetch` to `https://graph.microsoft.com/v1.0` (no Graph SDK, no MSAL: a new dependency needs an ADR and the client-credentials flow is one POST). Token from `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (`grant_type=client_credentials`, `scope=https://graph.microsoft.com/.default`), with either the client secret or a certificate-signed client assertion (JWT, RS256/PS256, signed with `node:crypto`). The access token (about an hour) is cached **in memory only**, never written to the database or logs. Retries on `429`/`503` with `Retry-After`. Error bodies are logged only as status and inner error code (they may echo ids); transcript text is never logged (as Phase 30).
- `organizers.ts`: maps a Help admin to their Entra user: `GET /users/{email}?$select=id,userPrincipalName,displayName` (`User.ReadBasic.All`), cached in `teams_organizers`; re-checked daily. An admin whose account is not in the policy group shows "Your Microsoft account is not enabled for Help" (Graph's 403).
- `meetings.ts`: create event, resolve link, connect/disconnect, check now.
- `transcripts.ts` + job `teams.transcript-poll` (pg-boss, scheduled every 5 minutes, picks due rows by `next_poll_at`, concurrency 1, each row a small unit of work) and in Phase 2 `teams.subscriptions-renew` (every 12 hours) and the webhook routes.
- `public-routes.ts`: the public page's JSON and `.ics`.
- **Module boundary:** the teams module never writes `knowledge_meetings`; it calls exported knowledge service functions (`getMeetingForTeams(itemId)`, `setMeetingLink`, `attachMeetingTranscript`) and reads people through the groups and users services. Knowledge never calls Graph.
- **Config** (`infra/config`, validated at start; the feature is off when the first three are missing, like OpenAI): `MS_TENANT_ID`, `MS_CLIENT_ID`, and one of `MS_CLIENT_CERT_PATH` + `MS_CLIENT_KEY_PATH` (preferred) or `MS_CLIENT_SECRET`; `TEAMS_WEBHOOK_CLIENT_STATE_KEY` (Phase 2, HMAC key that derives each subscription's `clientState`). Added to `.env.example` empty and to `deploy/*.env.example` with comments. All in the server env only.
- **ADR at implementation:** "Microsoft Graph app-only via plain fetch, calendar events for meetings, polling before webhooks" (next free number, at present 0035).

### Permissions (policy functions, `modules/teams/policy.ts`, test-first)

| function | rule |
|---|---|
| `canUseTeams(actor)` | an admin (superadmin included) and the integration is configured |
| `canCreateTeamsMeeting(actor, item)` | `canUseTeams` and `canEditItem(actor, item)` (knowledge) and the item is a meeting; the chosen organizer is a mapped organizer |
| `canConnectTeamsMeeting(actor, item)` | the same; only this explicit admin action links a pasted URL, never saving the link field |
| `canSeeTeamsState(actor, item)` | `canUseTeams` and `canReadItem` |
| `canShareTeamsTranscript(actor, item)` | `canProcessMeeting(actor)` (admins, Phase 30) and `canEditItem` |
| `canShareInvitation(actor, item)` | `canCreateTeamsMeeting` |

- **Why connecting is admins-only and explicit:** the transcript is fetched with the app's power, not the user's. If saving any link triggered an import, a client (an editor of their own meetings) could paste the link of another client's eGrant meeting and receive its transcript. Only an admin, who may see every group, can connect, and the UI shows the meeting's subject from Graph before confirming ("Connect 'Kickoff Mesto X' organised by J. Novák?").
- Clients never see the Teams block, the organizer or the state. The transcript reaches them only through the item's visibility and, for Teams imports, after "Share with the client".
- The public routes check only the token (constant-time compare of its hash) and expose only the fields listed above.
- MCP: the teams routes are **not** added to the MCP allowlist in v1 (creating meetings and sending invitations from an AI client is a later decision).

### Data model (migration outline, number taken at implementation; `origin/main` is at 0047 today)

```
teams_organizers                       -- Help admin ↔ Entra user
  user_id        text pk → user.id (cascade)
  entra_user_id  uuid not null unique
  upn            text not null
  display_name   text
  checked_at     timestamptz not null
  status         text not null          -- 'ok' | 'not_found' | 'no_policy'

teams_meetings                         -- one per connected knowledge meeting
  item_id            uuid pk            -- the knowledge item (cascade on item delete, via knowledge's delete hook)
  origin             text not null      -- 'help' (created here) | 'linked' (pasted link)
  organizer_entra_id uuid not null
  online_meeting_id  text not null      -- Graph id ("MSo…"), up to ~200 chars
  join_web_url       text not null
  join_meeting_id    text               -- digits, when known
  event_id           text               -- Help-made only
  ical_uid           text               -- Help-made only
  event_sequence     int not null default 0
  transcript_state   text not null      -- 'waiting' | 'imported' | 'available' (not applied: record had one) | 'none' | 'failed'
  transcript_ids     text[] not null default '{}'   -- Graph transcript ids already imported
  next_poll_at       timestamptz        -- null when polling is over
  poll_until         timestamptz
  last_error         text               -- inner error code only
  share_token_hash   bytea unique       -- public page; null = not shared
  created_by         text → user.id
  created_at, updated_at timestamptz
  index (next_poll_at) where next_poll_at is not null
  index (organizer_entra_id, online_meeting_id) unique

teams_subscriptions                    -- Phase 2
  id text pk (Graph subscription id), resource text, organizer_entra_id uuid,
  expires_at timestamptz, client_state_salt bytea, created_at
```

Knowledge (its own migration, same release): `knowledge_meetings.transcript_source` gains `'teams'`; new column `transcript_admins_only boolean not null default false` (true when the transcript came from Teams and has not been shared). The knowledge read path hides the transcript from non-admins while it is true (and the AI summary made from it, which is derived from the same text). No N+1: the meeting detail reads its `teams_meetings` row by primary key; the poll job reads due rows through the partial index, at most 50 per run.

### Realtime

No new socket events: an import or state change goes through the knowledge service, which emits `knowledge:item` as today; the Teams block refetches its state with the detail.

## Security

- **Least privilege** (application permissions, admin-consented):

  | permission | why | limited by |
  |---|---|---|
  | `OnlineMeetings.Read.All` | resolve a join URL / meeting id to the `onlineMeeting` | application access policy → group |
  | `OnlineMeetingTranscript.Read.All` | list and download transcripts; `getAllTranscripts` | application access policy → group; tenant switch "Transcript API access" |
  | `User.ReadBasic.All` | find an admin's Entra id by email (basic profile only) | read-only, no mail or files |
  | `Calendars.ReadWrite` **via Exchange RBAC for Applications**, not consented in Entra | create, update and cancel the event | management scope = members of the group |
  | `OnlineMeetings.ReadWrite.All` (Phase 2, instead of `.Read.All`) | `recordAutomatically`, `allowTranscription` | application access policy → group |
  | `OnlineMeetingArtifact.Read.All` (Phase 3) | attendance reports | application access policy → group |

  Not requested: `OnlineMeetingRecording.Read.All`, `CallRecords.Read.All`, `Chat.*`, `Mail.*`, `Files.*`.
- **Credentials: certificate preferred, secret acceptable.** A certificate's private key never leaves our server (the developer generates the key pair on the server with `openssl`, the owner uploads only the public `.cer` to the app registration), and nothing secret is typed or sent by email. A client secret is simpler but is a password that must be copied once and rotated (Entra allows at most 24 months; we use 12 and put a reminder in the admin dashboard 30 days before `MS_CLIENT_SECRET_EXPIRES`). Either lives only in the server's env/secret files under `deploy/` on the host (mode 600), **never in the repo, CI, chat or email**; the Docker image does not contain them.
- **Tokens:** app-only access tokens in memory only; no refresh tokens (no delegated flow). The public share token is stored hashed.
- **Webhook (Phase 2):** `POST /api/teams/notifications` and `POST /api/teams/lifecycle` outside the session and CSRF guards. Validation request: answer the URL-decoded `validationToken` as `text/plain` (escaped, never rendered) with `200` within 10 seconds. Notifications: body at most 64 KiB; every item's `clientState` must equal `HMAC(TEAMS_WEBHOOK_CLIENT_STATE_KEY, subscriptionId)` (constant-time) and its `subscriptionId` must be one we hold, `tenantId` must be ours, and `resource` must match `users/{known organizer}/onlineMeetings('…')/transcripts('…')`; otherwise ignored and counted. Valid items are queued and answered `202` within 3 seconds; the job **never trusts the payload** and re-reads the transcript from Graph with our token. No resource data, so no decryption key to protect. Rate limit 600 a minute. Optionally Caddy allows these two paths only from Microsoft's published Graph notification IP ranges.
- **Data protection:** transcripts are client personal data. They are stored only on the meeting record (same database and backups as today), admins-only until shared (decision 8), deleted with the record, never logged, never sent anywhere except the configured AI provider when an admin presses "Spracovať s AI" (as Phase 30). Teams shows its own recording/transcription notice to participants; open question 4 covers informing clients.
- **Failure modes are visible, not silent:** missing tenant switch (`GraphAccessToTranscriptsDisabled`), missing policy (`No application access policy`), expired meeting, organizer outside the group, each shown in the Teams block with what to fix.

## Owner setup checklist (for a non-expert)

You need a **Global Administrator** account of eGrant's Microsoft 365 (or one person with the roles Application Administrator, Teams Administrator and Exchange Administrator). Plan about an hour. Steps 1–5 are clicks in a browser; steps 6–8 are commands in PowerShell, which the developer can run with you on a shared screen.

**1. Make the group of organizers** (Microsoft Entra admin center, https://entra.microsoft.com)
1. Groups > All groups > **New group**. Group type: **Security** (if Exchange later refuses it in step 8, make it **Mail-enabled security** in the Exchange admin center instead). Name: `Help – Teams organizers`. Members: every eGrant admin who organises client calls, **added directly** (not through another group).
2. Open the group and copy its **Object ID**. You will need it in steps 6 and 8.

**2. Register the app**
1. Entra admin center > Identity > Applications > **App registrations** > **New registration**.
2. Name: `Help by eGrant – Teams`. Supported account types: **Accounts in this organizational directory only**. Redirect URI: leave empty. **Register**.
3. On the Overview page copy **Application (client) ID** and **Directory (tenant) ID**.

**3. Add the permissions**
1. In the app: **API permissions** > **Add a permission** > **Microsoft Graph** > **Application permissions**.
2. Tick `OnlineMeetings.Read.All`, `OnlineMeetingTranscript.Read.All`, `User.ReadBasic.All`. **Add permissions**.
3. **Do not** add `Calendars.ReadWrite` here (step 8 gives it, limited to the group).
4. Remove the delegated `User.Read` that Entra adds by default (not needed).

**4. Give admin consent**
1. Still in API permissions: **Grant admin consent for eGrant** > Yes. Every row shows a green "Granted".

**5. Add the credential** (choose one)
- **Certificate (recommended):** the developer sends you a file `help-teams.cer` (public part only). In the app: **Certificates & secrets** > **Certificates** > **Upload certificate** > choose the file > description `Help server` > Add. Copy the **Thumbprint** and send it to the developer.
- **Client secret:** **Certificates & secrets** > **Client secrets** > **New client secret** > description `Help server`, expires **12 months** > Add. Copy the **Value** at once (it is shown only once). **Do not send it by email or chat**: put it on the server yourself (step 10) or read it to the developer during a call while they type it into the server. Note the expiry date.

**6. Allow the app to read meetings of the group** (PowerShell, Teams module)
```powershell
Install-Module MicrosoftTeams -Scope CurrentUser      # once
Connect-MicrosoftTeams                                # sign in as admin
New-CsApplicationAccessPolicy -Identity "Help-Teams" -AppIds "<Application (client) ID>" -Description "Help by eGrant: meetings and transcripts"
Grant-CsApplicationAccessPolicy -PolicyName "Help-Teams" -Group "<group Object ID>"
```
Do **not** use `-Global`. It takes up to 30 minutes to work. If an organizer already has another application access policy, tell the developer (a person can have only one; the app IDs must then be added to that policy).

**7. Turn on transcripts for apps and transcription for organizers**
1. Teams admin center (https://admin.teams.microsoft.com) > Meetings > **Meeting settings** > **Transcript API access**: **Microsoft Graph access** On; **Configure** > **Include speaker attribution** On. Save. (Or `Set-CsTeamsMeetingConfiguration -EnableGraphTranscriptAccess true -EnableAttributedTranscripts true -Identity Global`.)
2. Meetings > **Meeting policies**: in the policy the organizers have (usually **Global**), **Transcription** On (default for new policies) and **Recording** On. Save.
3. Optional, so meetings can transcribe themselves: in PowerShell `Set-CsTeamsMeetingPolicy -Identity Global -AutoRecording Enabled` (or the same on a custom policy assigned to the group with `Grant-CsTeamsMeetingPolicy -Group "<group Object ID>" -PolicyName "<policy>"`).

**8. Allow the app to manage calendars of the group only** (PowerShell, Exchange module)
```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser   # once
Connect-ExchangeOnline
# IDs from Entra admin center > Enterprise applications > "Help by eGrant – Teams" (not App registrations):
New-ServicePrincipal -AppId "<Application ID>" -ObjectId "<Enterprise application Object ID>" -DisplayName "Help by eGrant – Teams"
$dn = (Get-Group "Help – Teams organizers").DistinguishedName
New-ManagementScope -Name "Help Teams organizers" -RecipientRestrictionFilter "MemberOfGroup -eq '$dn'"
New-ManagementRoleAssignment -App "<Enterprise application Object ID>" -Role "Application Calendars.ReadWrite" -CustomResourceScope "Help Teams organizers"
Test-ServicePrincipalAuthorization -Identity "<Enterprise application Object ID>" -Resource "<an organizer's email>"   # shows InScope True
```
It takes 30 minutes to 2 hours to work.

**9. Send to the developer** (fine by email or chat; these are not secrets): Directory (tenant) ID; Application (client) ID; the certificate thumbprint (or "secret, expires <date>"); the group's name and Object ID; the emails of the organizers; confirmation that steps 6–8 ran without errors.

**10. Only on the server** (never in email, chat or the repository): the client secret, if you chose one, in the server's env file as `MS_CLIENT_SECRET`; with a certificate, the private key the developer generated stays on the server (`MS_CLIENT_KEY_PATH`) and never leaves it.

**11. Test together:** an organizer creates a meeting from a test record in Help, joins it, starts transcription, speaks a minute, ends the meeting; within about 10 minutes the transcript is on the record.

To switch everything off later: delete the app registration (Entra) or remove the policy grant (`Grant-CsApplicationAccessPolicy -PolicyName $null -Group …`) and the role assignment (`Remove-ManagementRoleAssignment`).

## Costs and licensing

- **Microsoft Graph:** no charge. The Teams APIs (transcripts and recordings included, with their change notifications) have not been metered since 2025-08-25; no Azure subscription or billing setup is needed. The Entra app registration is free.
- **Licences:** each organizer needs a Microsoft 365 licence with Teams and an Exchange Online mailbox (calendar), e.g. Business Basic, Standard or Premium, or Office/Microsoft 365 E-plans with Teams (in the EU, "no Teams" suites need the separate Teams licence). Transcription and "Record and transcribe automatically" come with these. Business plans host meetings of up to 300 people.
- **Teams Premium: not needed.** It adds only enforced meeting templates (automatic transcription locked on), live translated transcripts and AI recaps; none of this design depends on it. Copilot is not needed either.
- **Storage:** Teams keeps recordings and transcripts in the organizer's OneDrive (counts against OneDrive storage); automatic recording records video too.
- **Our side:** no new server cost; the AI summary costs OpenAI tokens per run as in Phase 30 (an automatic run per meeting, idea 3, would make this a cost per meeting rather than per click).
- **Caveats:** transcripts exist only when transcription ran; meetings organised by someone outside the policy group or outside eGrant's tenant cannot be read (paste or upload stays); meetings expire after 60 days without use, after which Graph no longer returns their transcripts (we poll for 3 days only); private channel meetings are not covered by notifications; Microsoft documents that the join-URL format may change.

## Tighter integration: ideas ranked

Value for eGrant's daily work against effort; the first four are proposed for Phase 2 and 3.

| # | idea | value | effort | notes |
|---|---|---|---|---|
| 3 | **AI summary and tasks automatically** after the transcript arrives (Phase 30's run, then a notification "Summary ready, N action items") | high | S | reuses Phase 30 entirely; a per-meeting checkbox "Summarise automatically" set at creation (default on for Help-made meetings); admins-only like today |
| 4 | **Post the meeting into the client's group chat**: on creation a system message "Teams meeting <time>, Join" (the client sees the link where they already work), and after the summary is shared "Summary of <title>" as a knowledge card | high | S | through the chat service; respects the transcript sharing flag |
| 1 | **Create the knowledge record automatically** when an organizer's meeting with a client ends: `getAllTranscripts` delta per organizer (or the Phase 2 subscription) finds transcripts of meetings Help does not know; the meeting's attendees' emails are matched to a group's clients; one match → a new meeting record in that group (admins-only until reviewed) with the transcript; several or none → an "Unassigned Teams meetings" list on the admin dashboard | high | M | removes the paste step entirely for client calls; matching rule is an open question |
| 2 | **Attendance report** on the record (who joined, how long): `GET …/onlineMeetings/{id}/attendanceReports` and records | medium | S | needs `OnlineMeetingArtifact.Read.All`; reports are kept one year |
| 7 | **Deep links** from Help to Teams: "Open meeting chat in Teams" (`https://teams.microsoft.com/l/chat/{chatInfo.threadId}/0`), the organizer's meeting options (`meetingOptionsWebUrl`) | medium | XS | data already in the `onlineMeeting` |
| 5 | **Help notifications into Teams** (a ticket from eGrant, a mention): a Workflows webhook per admin or channel (Workflows "post to a chat/channel when a webhook request is received", no premium licence; payload an Adaptive Card) as one more delivery channel next to email and push | medium | M | the old Office 365 connector webhooks are being replaced by Workflows; a real bot (Azure Bot registration, Teams app) is much more work and not proposed |
| 6 | **Calendar of task deadlines**: a private, revocable `.ics` feed per user (`/api/me/calendar/<token>.ics`) of their tasks' deadlines and meetings, subscribed in Outlook or Google | medium | S | no Graph needed (and no write access to calendars); works for clients too |
| 8 | **Recording fallback**: no transcript but a recording exists → download it (`OnlineMeetingRecording.Read.All`) into Phase 30's pipeline (ffmpeg to audio, our transcription) | low–medium | M | large downloads; only if transcription is often forgotten |
| 9 | Two-way sync of edits made in Outlook (event subscriptions) | low | M | Help is the source for Help-made meetings; Outlook edits are rare |

## Phasing

- **T0 – setup and spike** (owner + developer, half a day): the checklist above; a script `scripts/teams-spike.sh` (not shipped) that, with the real tenant, creates an event, resolves its join URL, lists transcripts of a test meeting, resolves a pasted classic link and a new `/meet/` link, and tries `recordAutomatically` on the event's meeting. It confirms the three things the docs leave open: the shape of `joinWebUrl` for `/meet/` links, how soon a transcript is listed after the meeting, and whether `PATCH recordAutomatically` works on calendar-backed meetings.
- **T1 – MVP** (one pull request): config and Graph client; `teams_organizers`; **Create Teams meeting** (calendar event with invitations) from a meeting record; **Connect to Teams** for a pasted link; the poll job and transcript import (admins-only until shared, notification to admins); the Teams block states; the public **add-to-calendar** page with `.ics`, Outlook and Google links; docs (`product/knowledge-base.md`, `architecture/permissions.md`, `data-model.md`, `overview.md`, a runbook `runbooks/teams.md` with the checklist, `.env.example`, ADR), texts in all nine languages in the knowledge lazy namespace (the eager bundle is full).
- **T2:** per-organizer transcript subscriptions with lifecycle handling and renewal (poll becomes the fallback); "Record and transcribe automatically" checkbox; time/title sync and cancel of Help-made meetings; ideas 3 and 4.
- **T3:** idea 1 (records from the calendar), 2 (attendance), 7 (deep links); then 6 and 5 as the owner prefers.

## Decisions we took

1. Calendar events, not standalone `onlineMeetings` (transcripts are not readable otherwise).
2. Application permissions only; no per-admin Microsoft sign-in.
3. Access limited to one security group through the Teams application access policy and Exchange RBAC for Applications; no tenant-wide grants; `Calendars.ReadWrite` never consented in Entra.
4. MVP polls the known meetings; webhooks (per organizer, without resource data, so no certificate for encryption) in Phase 2.
5. No Teams Premium; transcription started by the organizer, automatic start as an opt-in checkbox later.
6. The record stores the `onlineMeeting` id and organizer id (plus event id and `iCalUId` when Help made it); the pasted URL is only a key to look them up, its `Tid`/`Oid` only hints.
7. Invitations through Graph for chosen people plus a public add-to-calendar page with `.ics` (`UID` = `iCalUId`) and Outlook/Google links for everyone else.
8. A transcript imported from Teams stays admins-only until an admin shares it with the client.
9. Only admins create and connect Teams meetings; connecting is an explicit action, never a side effect of saving a link.
10. Certificate credential preferred, a 12-month client secret accepted; secrets only in the server env.
11. No Graph SDK or MSAL (plain fetch and `node:crypto`), so no new dependency.
12. Teams routes are not exposed through MCP in v1.

## Open questions for the owner

1. **Who organises client calls?** Only admins in the policy group, or should any eGrant colleague's meetings be readable (then the group grows; meetings organised by clients themselves stay out of reach either way)?
2. **Transcript visibility:** keep Teams transcripts admins-only until shared (our default), or show them to the group's clients right away like a pasted one? And the AI summary made from it?
3. **Automatic recording:** may Help switch on "Record and transcribe automatically" for meetings it creates (it also records video into the organizer's OneDrive), and should that be the default?
4. **Client consent:** do client contracts or eGrant's privacy notice already cover recording and transcribing calls, or should the invitation text say so?
5. **Invitations:** default invitees = the group's clients and its managers? Should Help ever send Outlook invitations to people outside the group?
6. **Credential:** certificate (developer generates it on the server) or client secret (you create it in Entra)?
7. **Public invitation page:** acceptable that anyone with the link sees the title, time and join link? (The join link alone already admits people to the lobby.) Should the title be hidden there?
8. **Automatic records (idea 1):** how to match a meeting to a client: by attendees' email domains, by the exact emails of the group's clients, or only by a group-specific word in the meeting title?
9. **Language of the Teams meetings:** set `meetingSpokenLanguageTag` (e.g. `sk-SK`) when Help creates a meeting, per group, to improve Teams' transcription? Teams supports Slovak, Czech, Slovenian, Bulgarian, Estonian, Italian, Croatian, Ukrainian and English.
10. **Order:** which of the ranked ideas matter most after the MVP?

## Sources

Microsoft Learn, read 2026-10-18:

- Create onlineMeeting: https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings?view=graph-rest-1.0
- Create event (invitations, `iCalUId`, online meeting example): https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0
- Create or set an event as an online meeting: https://learn.microsoft.com/en-us/graph/outlook-calendar-online-meetings
- Application access policy: https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy
- Grant-CsApplicationAccessPolicy (`-Group`): https://learn.microsoft.com/en-us/powershell/module/microsoftteams/grant-csapplicationaccesspolicy
- RBAC for Applications in Exchange Online: https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac
- Get onlineMeeting (by `JoinWebUrl`, `joinMeetingId`): https://learn.microsoft.com/en-us/graph/api/onlinemeeting-get?view=graph-rest-1.0
- onlineMeeting resource (`recordAutomatically`, `allowTranscription`, `joinWebUrl` format warning, 60-day expiry): https://learn.microsoft.com/en-us/graph/api/resources/onlinemeeting?view=graph-rest-1.0
- Update onlineMeeting: https://learn.microsoft.com/en-us/graph/api/onlinemeeting-update?view=graph-rest-1.0
- List transcripts: https://learn.microsoft.com/en-us/graph/api/onlinemeeting-list-transcripts?view=graph-rest-1.0
- Get callTranscript and content formats, tenant controls: https://learn.microsoft.com/en-us/graph/api/calltranscript-get?view=graph-rest-1.0
- getAllTranscripts (and delta): https://learn.microsoft.com/en-us/graph/api/onlinemeeting-getalltranscripts?view=graph-rest-1.0
- Change notifications for transcripts and recordings: https://learn.microsoft.com/en-us/graph/teams-changenotifications-callrecording-and-calltranscript
- Subscription resource (lifetimes, `lifecycleNotificationUrl`, latency): https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0
- Receive change notifications through webhooks (validation, 3 s, retries): https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks
- Change notifications with resource data (encryption): https://learn.microsoft.com/en-us/graph/change-notifications-with-resource-data
- Metered APIs (Teams APIs no longer metered since 2025-08-25): https://learn.microsoft.com/en-us/graph/metered-api-list
- Manage transcript API access for Teams meetings: https://learn.microsoft.com/en-us/microsoftteams/meeting-transcript-api-access
- Manage transcription and captions (`AllowTranscription`): https://learn.microsoft.com/en-us/microsoftteams/meeting-transcription-captions
- Manage Teams meeting auto recording (`AutoRecording`, Premium templates): https://learn.microsoft.com/en-us/microsoftteams/manage-teams-auto-recording
- Limits and specifications for Teams (meeting expiration, meeting sizes): https://learn.microsoft.com/en-us/microsoftteams/limits-specifications-teams
- meetingAttendanceReport: https://learn.microsoft.com/en-us/graph/api/resources/meetingattendancereport?view=graph-rest-1.0
- Call records API: https://learn.microsoft.com/en-us/graph/api/resources/callrecords-api-overview?view=graph-rest-1.0
- Create incoming webhooks with Workflows for Teams: https://support.microsoft.com/en-us/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498
- Join a meeting in Teams (new link format since January 2026): https://support.microsoft.com/teams/meetings/join-a-meeting-in-microsoft-teams
- iCalendar: RFC 5545, https://www.rfc-editor.org/rfc/rfc5545
