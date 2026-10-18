# Microsoft Teams integration (design)

Status: **T1 (MVP) built** (2026-10-18); T2 and T3 planned. The owner's answers are under [Owner answers](#owner-answers-2026-10-18); the remaining decisions are ours, made autonomously and open to the owner's veto. Researched against Microsoft's documentation as of 2026-10-18 (Graph v1.0); every claim about Microsoft links to its source in [Sources](#sources).

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
- **Transcripts, MVP: targeted polling**, no webhook: for each connected record a job lists `…/onlineMeetings/{id}/transcripts` from the start time on (every 5 minutes for the first 3 hours after the planned end, then hourly up to 3 days), downloads `/content` as WebVTT and stores it through the knowledge service. **T2:** change notifications per organizer (`users/{id}/onlineMeetings/getAllTranscripts`, without resource data, so no encryption certificate) cut the delay to seconds; the poll stays as a safety net.
- **Add to calendar for anyone with the link:** a public page `/m/<token>` with "Join in Teams", "Add to Outlook", "Add to Google Calendar" and "Download .ics"; the `.ics` carries the event's `iCalUId` as its `UID`, so a person who also got the Outlook invitation does not get a second event. Graph invitations go to the people the organizer picks (nobody by default, owner answer 4).
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

**Decision 4:** MVP polls the transcripts of connected meetings; T2 adds per-organizer subscriptions. Polling is simple (no public webhook, no 3-day renewals, no lifecycle endpoint), touches only the meetings Help knows, and its delay (≤ 5 minutes for 3 hours after the planned end) is fine for a summary read later. The per-organizer subscription (not tenant-wide) keeps notifications to the policy group's meetings. Neither uses resource data, so no encryption certificate.

### Must transcription be started by hand?

Yes, by default someone in the meeting presses Record or Start transcription; no transcription means no transcript to attach. The options:

1. **Meeting policy "Transcription"** (Teams admin center > Meetings > Meeting policies; `Set-CsTeamsMeetingPolicy -AllowTranscription $true`): on by default for new policies; it only *allows* transcribing. Both the organizer and the person starting it need it on.
2. **"Record and transcribe automatically"** meeting option: offered to organizers whose meeting policy has `-AutoRecording Enabled`; off per meeting by default; when on, recording and transcription start without anyone pressing anything. Graph exposes it as `onlineMeeting.recordAutomatically` (updatable with `PATCH /users/{id}/onlineMeetings/{id}`, needs `OnlineMeetings.ReadWrite.All`). `allowTranscription` (also updatable, applies to a running meeting) only allows it. This is **not** a Teams Premium feature.
3. **Teams Premium meeting templates** can enforce automatic recording and transcription with a locked setting ("Only organizers with a Teams Premium license can use assigned meeting templates").

**Decision 5:** no Premium. The setup turns on `AllowTranscription` and `AutoRecording Enabled` for the policy group; **in T1** the "Create Teams meeting" dialog has a checkbox **"Record and transcribe automatically"**, **on by default** (owner answer 2), that sets `recordAutomatically` (and `allowTranscription`) on the event's online meeting right after creating the event; if Graph does not list the online meeting yet, the poll job applies it before the start. It also records video into the organizer's OneDrive. With the box off, someone starts transcription in the call.

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

**Decision 7:** both. The dialog lists the people to invite (the group's clients and its managers, **none ticked**, more emails can be typed; owner answer 4); the record shows "Copy invitation link" with the public page.

## Product design

### Meeting record (knowledge item of type Meeting)

New block **Teams** in the meeting detail, admins only (clients see only the join pill as today):

- No Teams meeting yet: **"Create Teams meeting"** (admins who can edit the item). Inline form: title and time from the record (editable there, not here), length (30 to 120 minutes, default 60), "Record and transcribe automatically" (on), invitees (the group's clients and managers with their emails, none ticked; extra emails), and the notice the invitation will carry. The organizer is always the signed-in admin (owner answer 1; no choice of another organizer in T1). Outlook invitations always go to the picked people (Graph cannot create an event with attendees without inviting them). On success the record's meeting link is set to the join URL and the block shows the state.
- **"Connect Teams link"** (admins): the form is prefilled with the record's meeting link. Refusals: "not a Teams meeting link", "organised outside eGrant (paste or upload the transcript)", "the organizer is not an eGrant colleague with a Help account", "no eGrant organizer has this meeting". While Teams is not set up the block does not exist. T1 connects without the confirmation step showing Graph's subject (T2).
- Connected: origin, organizer, the recording choice, "Transcript: Help checks after the call / imported / Teams has one, the call kept its own / none (nobody started transcription) / could not be fetched", last and next check, the last Graph error code, with **"Check now"**, **"Replace with the Teams transcript"**, **"Copy invitation link"** (Help-made meetings) and **"Disconnect"**.
- Editing the record's time or title of a Help-made meeting asks "Update the Teams meeting and notify invitees too?" (T2; in T1 the Outlook event keeps its time and title, the public page follows the record). Deleting the record asks whether to cancel the Teams meeting (T2; in T1 deleting the record deletes its Teams row and the meeting stays in Outlook).

### Transcript import

- When transcripts appear for the meeting, the job keeps those whose `createdDateTime` lies in the record's window (from 1 hour before `startsAt` to 12 hours after; this matters for **recurring series**, which share one `onlineMeeting` and list the transcripts of every occurrence), orders them by time (a meeting where transcription was stopped and restarted has several), downloads each as `text/vtt` (falling back to the unattributed format on `403 SpeakerAttributionNotAllowed`), converts VTT to text with the Phase 30 parser (speaker kept as "Name: "), joins them with a blank line and hands the text to the knowledge module (`attachMeetingTranscript(itemId, text, { source: 'teams' })`), which stores it with `transcript_source = 'teams'`, bumps `updated_at` and sends `knowledge:item`.
- An existing transcript is never overwritten: the block shows "A Teams transcript is available" with **"Replace with the Teams transcript"**. The record's transcript link is set to nothing (the Teams transcript lives in the meeting's chat; we keep our copy).
- **T2:** the admins who can process the meeting get one notification "Transcript of <title> is ready" (the Meetings notification group; a new event kind `meeting_transcript_ready`). T1 only pushes `knowledge:item`, so an open detail refreshes.
- **Visibility (decision 8):** the transcript follows the item's visibility as in Phase 30, **but** a transcript imported from Teams is held **admins-only until an admin presses "Share transcript with the client"** (per-meeting flag `knowledge_meetings.transcript_admins_only`). A client call may contain internal remarks after the client left; an automatic import must not publish them. Manual pastes keep today's rule. While held, a client's edit of the record never touches the transcript or summary, and search leaves the held summary out.

### Public "add to calendar" page

`/m/<token>` (no sign-in, `noindex`, `no-store`, minimal lazy route): title, date and time in the viewer's time zone, **Join in Teams**, **Add to Outlook**, **Add to Google Calendar**, **Download .ics** (`?lang=` for its texts) and the **recording notice** (owner answer 3), in the viewer's language among the nine. Nothing else from the record (no notes, transcript, organizer, group; the owner accepted the title, answer 7). `GET /api/public/meetings/:token` (JSON: `title`, `startsAt`, `endsAt`, `joinUrl`, `recorded`) and `GET /api/public/meetings/:token/invite.ics`. Token: 128 bits, base64url, `HMAC-SHA256(APP_SECRET, item id + random nonce)` cut to 16 bytes: only the nonce and the token's SHA-256 are stored, so an admin can copy the link again; Disconnect revokes it. 60 requests a minute per IP. Only for Help-made meetings (a connected manual meeting has no event to mirror; T2 may allow it with the times from Graph). The times and title follow the record.

## Architecture

### Module `modules/teams` (server) and `features/teams` (web)

The same pattern as the other modules. As built in T1:

- `graph-client.ts`: plain `fetch` to `https://graph.microsoft.com/v1.0` (no Graph SDK, no MSAL: a new dependency needs an ADR and the client-credentials flow is one POST). Token from `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (`grant_type=client_credentials`, `scope=https://graph.microsoft.com/.default`), with either the client secret or a certificate-signed client assertion (JWT, RS256/PS256, signed with `node:crypto`). The access token (about an hour) is cached **in memory only**, never written to the database or logs. Retries on `429`/`503` with `Retry-After`. Error bodies are logged only as status and inner error code (they may echo ids); transcript text is never logged (as Phase 30).
- `organizers.ts`: maps a Help admin to their Entra user: `GET /users/{email}?$select=id,userPrincipalName,displayName` (`User.ReadBasic.All`), cached in `teams_organizers` for a day. The known organizers are all active Help admins with an account. An admin whose account is not in the policy group gets `teams_not_organizer` ("Your Microsoft account is not in the Help Teams organizers group") from Graph's 403/404 on the calendar write; T1 adds no group-membership permission for a pre-check.
- `service.ts`: create event, resolve link, connect/disconnect, the state; `links.ts` parses a pasted link; `calendar-token.ts`; `schedule.ts` the poll times and the transcript window; `policy.ts`.
- `transcripts.ts` + job `teams.transcript-poll` (pg-boss, scheduled every 5 minutes, stately, picks at most 50 due rows by `next_poll_at`, one after the other) and in T2 `teams.subscriptions-renew` (every 12 hours) and the webhook routes.
- `public-routes.ts`: the public page's JSON and `.ics`.
- `features/teams` (web): `teams-section.tsx` (lazy, admins only, in the meeting detail), `public-meeting-page.tsx` (route `/m/$token`), `calendar-links.ts`, texts in the lazy `teams` namespace.
- **Module boundary:** the teams module never writes `knowledge_meetings`; it calls the knowledge module's `meeting-teams.ts` (`getMeetingForTeams`, `meetingForTeamsAction`, `setMeetingUrlFromTeams`, `attachTeamsTranscript`; `shareMeetingTranscript` is a knowledge route) and reads people through the groups and users services. Knowledge never calls Graph.
- **Config** (`infra/config`, validated at start; the feature is off when no `TEAMS_*` variable is set, a partial set refuses to start, owner answer 5): `TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID`, and either `TEAMS_CLIENT_SECRET` or `TEAMS_CERT_PATH` (a PEM file with the private key; the certificate may be in it too) + `TEAMS_CERT_THUMBPRINT` (SHA-1, 40 hex digits; colons and spaces allowed). `TEAMS_WEBHOOK_CLIENT_STATE_KEY` comes in T2. In `.env.example`, `deploy/test.env.example` and the [deploy runbook](../../runbooks/deploy.md#microsoft-teams). Server env only.
- **ADR:** [0036](../../decisions/0036-teams-graph-app-only-plain-fetch.md).

### Permissions (policy functions, `modules/teams/policy.ts`, test-first)

| function | rule |
|---|---|
| `canUseTeams(actor, configured)` | an admin (superadmin included) and the integration is configured; everyone else gets 404 from every Teams route |
| `canLinkTeamsMeeting(actor, { configured, canEditItem, linked })` | create or connect: `canUseTeams`, `canEditItem` (knowledge, through `meetingForTeamsAction`) and no Teams meeting yet (else 409) |
| `canManageTeamsLink(…)` | check, replace, disconnect: the same on a connected meeting |
| `canShareMeetingTranscript(actor)` (knowledge policy) | admins, on a meeting they read |

- **Why connecting is admins-only and explicit:** the transcript is fetched with the app's power, not the user's. If saving any link triggered an import, a client (an editor of their own meetings) could paste the link of another client's eGrant meeting and receive its transcript. Only an admin, who may see every group, can connect, and the UI shows the meeting's subject from Graph before confirming ("Connect 'Kickoff Mesto X' organised by J. Novák?").
- Clients never see the Teams block, the organizer or the state. The transcript reaches them only through the item's visibility and, for Teams imports, after "Share with the client".
- The public routes check only the token (constant-time compare of its hash) and expose only the fields listed above.
- MCP: the teams routes are **not** added to the MCP allowlist in v1 (creating meetings and sending invitations from an AI client is a later decision).

### Data model (migration 0048)

Owner answer 6: the Teams fields extend the existing knowledge meeting, in a small table of the teams module keyed by the meeting (`teams_meeting_links`), because modules never touch another module's tables; the transcript flag sits on `knowledge_meetings`, whose read path enforces it. Migration **0048** (the next free number on `origin/main`, which ends at 0047) holds both. As built:

```
teams_organizers                       -- Help admin ↔ Entra user
  user_id        text pk → user.id (cascade)
  entra_user_id  text not null unique
  upn            text not null
  display_name   text
  checked_at     timestamptz not null   -- trusted for a day; a missing account deletes the row

teams_meeting_links                    -- the Teams side of one knowledge meeting
  item_id              text pk → knowledge_meetings.item_id (cascade)
  origin               text not null    -- 'help' | 'linked'
  organizer_user_id    text → user.id (set null)
  organizer_entra_id   text not null
  organizer_name       text
  online_meeting_id    text             -- null until Graph lists the event's online meeting
  join_url             text not null
  event_id, ical_uid   text             -- Help-made only
  duration_minutes     int not null
  record_automatically boolean not null default false
  record_applied       boolean not null default false
  transcript_state     text not null default 'waiting'  -- waiting | imported | available | none | failed
  transcript_ids       text[] not null default '{}'     -- the Graph transcripts of the last import
  next_poll_at         timestamptz      -- null when polling is over; partial index
  last_polled_at       timestamptz
  last_error           text             -- Graph error code only
  calendar_nonce       text             -- public page; token = HMAC(APP_SECRET, item, nonce)
  calendar_token_hash  text             -- SHA-256 of the token; partial unique index
  created_by           text → user.id (set null)
  created_at, updated_at timestamptz

knowledge_meetings (existing, Phase 30)
  transcript_source        + 'teams'
  transcript_admins_only   boolean not null default false

teams_subscriptions                    -- T2
  id text pk (Graph subscription id), resource text, organizer_entra_id text,
  expires_at timestamptz, client_state_salt bytea, created_at
```

The knowledge read path hides the transcript and the AI summary from non-admins while `transcript_admins_only` is true. No N+1: the Teams block reads its row by primary key in its own request (the meeting detail itself adds no query); the poll job reads due rows through the partial index, at most 50 per run. A recurring series may be connected to several records (no unique key on the online meeting): each record keeps the transcripts of its own time window.

### Realtime

No new socket events: an import or state change goes through the knowledge service, which emits `knowledge:item` as today; the Teams block refetches its state with the detail.

## Security

- **Least privilege** (application permissions, admin-consented):

  | permission | why | limited by |
  |---|---|---|
  | `OnlineMeetings.ReadWrite.All` (T1, because automatic recording is on by default) | resolve a join URL / meeting id to the `onlineMeeting`; set `recordAutomatically`, `allowTranscription` | application access policy → group |
  | `OnlineMeetingTranscript.Read.All` | list and download transcripts; `getAllTranscripts` | application access policy → group; tenant switch "Transcript API access" |
  | `User.ReadBasic.All` | find an admin's Entra id by email (basic profile only) | read-only, no mail or files |
  | `Calendars.ReadWrite` **via Exchange RBAC for Applications**, not consented in Entra | create, update and cancel the event | management scope = members of the group |
  | `OnlineMeetingArtifact.Read.All` (Phase 3) | attendance reports | application access policy → group |

  Not requested: `OnlineMeetingRecording.Read.All`, `CallRecords.Read.All`, `Chat.*`, `Mail.*`, `Files.*`.
- **Credentials: both supported (owner answer 5), certificate recommended.** A certificate's private key never leaves our server (the developer generates the key pair on the server with `openssl`, the owner uploads only the public `.cer` to the app registration), and nothing secret is typed or sent by email. A client secret is simpler but is a password that must be copied once and rotated (Entra allows at most 24 months; we use 12; a dashboard reminder before expiry is T2). Either lives only in the server's env/secret files under `deploy/` on the host (mode 600), **never in the repo, CI, chat or email**; the Docker image does not contain them.
- **Tokens:** app-only access tokens in memory only; no refresh tokens (no delegated flow). The public share token is stored hashed.
- **Webhook (T2):** `POST /api/teams/notifications` and `POST /api/teams/lifecycle` outside the session and CSRF guards. Validation request: answer the URL-decoded `validationToken` as `text/plain` (escaped, never rendered) with `200` within 10 seconds. Notifications: body at most 64 KiB; every item's `clientState` must equal `HMAC(TEAMS_WEBHOOK_CLIENT_STATE_KEY, subscriptionId)` (constant-time) and its `subscriptionId` must be one we hold, `tenantId` must be ours, and `resource` must match `users/{known organizer}/onlineMeetings('…')/transcripts('…')`; otherwise ignored and counted. Valid items are queued and answered `202` within 3 seconds; the job **never trusts the payload** and re-reads the transcript from Graph with our token. No resource data, so no decryption key to protect. Rate limit 600 a minute. Optionally Caddy allows these two paths only from Microsoft's published Graph notification IP ranges.
- **Data protection:** transcripts are client personal data. They are stored only on the meeting record (same database and backups as today), admins-only until shared (decision 8), deleted with the record, never logged, never sent anywhere except the configured AI provider when an admin presses "Spracovať s AI" (as Phase 30). Teams shows its own recording/transcription notice to participants; Help adds its notice to the invitation and the public page (owner answer 3); see [Legal](#legal).
- **Failure modes are visible, not silent:** missing tenant switch (`GraphAccessToTranscriptsDisabled`), missing policy (`No application access policy`), expired meeting, organizer outside the group, each shown in the Teams block with what to fix.

## Owner setup checklist (for a non-expert)

Moved to [integrations/teams.md](../../integrations/teams.md), updated for T1: `OnlineMeetings.ReadWrite.All` instead of `.Read.All` (automatic recording), `AutoRecording Enabled` needed for the default, and the `TEAMS_*` environment variables.

## Costs and licensing

- **Microsoft Graph:** no charge. The Teams APIs (transcripts and recordings included, with their change notifications) have not been metered since 2025-08-25; no Azure subscription or billing setup is needed. The Entra app registration is free.
- **Licences:** each organizer needs a Microsoft 365 licence with Teams and an Exchange Online mailbox (calendar), e.g. Business Basic, Standard or Premium, or Office/Microsoft 365 E-plans with Teams (in the EU, "no Teams" suites need the separate Teams licence). Transcription and "Record and transcribe automatically" come with these. Business plans host meetings of up to 300 people.
- **Teams Premium: not needed.** It adds only enforced meeting templates (automatic transcription locked on), live translated transcripts and AI recaps; none of this design depends on it. Copilot is not needed either.
- **Storage:** Teams keeps recordings and transcripts in the organizer's OneDrive (counts against OneDrive storage); automatic recording records video too.
- **Our side:** no new server cost; the AI summary costs OpenAI tokens per run as in Phase 30 (an automatic run per meeting, idea 3, would make this a cost per meeting rather than per click).
- **Caveats:** transcripts exist only when transcription ran; meetings organised by someone outside the policy group or outside eGrant's tenant cannot be read (paste or upload stays); meetings expire after 60 days without use, after which Graph no longer returns their transcripts (we poll for 3 days only); private channel meetings are not covered by notifications; Microsoft documents that the join-URL format may change.

## Tighter integration: ideas ranked

Value for eGrant's daily work against effort; the first four are proposed for T2 and T3.

| # | idea | value | effort | notes |
|---|---|---|---|---|
| 3 | **AI summary and tasks automatically** after the transcript arrives (Phase 30's run, then a notification "Summary ready, N action items") | high | S | reuses Phase 30 entirely; a per-meeting checkbox "Summarise automatically" set at creation (default on for Help-made meetings); admins-only like today |
| 4 | **Post the meeting into the client's group chat**: on creation a system message "Teams meeting <time>, Join" (the client sees the link where they already work), and after the summary is shared "Summary of <title>" as a knowledge card | high | S | through the chat service; respects the transcript sharing flag |
| 1 | **Create the knowledge record automatically** when an organizer's meeting with a client ends: `getAllTranscripts` delta per organizer (or the T2 subscription) finds transcripts of meetings Help does not know; the meeting's attendees' emails are matched to a group's clients; one match → a new meeting record in that group (admins-only until reviewed) with the transcript; several or none → an "Unassigned Teams meetings" list on the admin dashboard | high | M | removes the paste step entirely for client calls; matching rule is an open question |
| 2 | **Attendance report** on the record (who joined, how long): `GET …/onlineMeetings/{id}/attendanceReports` and records | medium | S | needs `OnlineMeetingArtifact.Read.All`; reports are kept one year |
| 7 | **Deep links** from Help to Teams: "Open meeting chat in Teams" (`https://teams.microsoft.com/l/chat/{chatInfo.threadId}/0`), the organizer's meeting options (`meetingOptionsWebUrl`) | medium | XS | data already in the `onlineMeeting` |
| 5 | **Help notifications into Teams** (a ticket from eGrant, a mention): a Workflows webhook per admin or channel (Workflows "post to a chat/channel when a webhook request is received", no premium licence; payload an Adaptive Card) as one more delivery channel next to email and push | medium | M | the old Office 365 connector webhooks are being replaced by Workflows; a real bot (Azure Bot registration, Teams app) is much more work and not proposed |
| 6 | **Calendar of task deadlines**: a private, revocable `.ics` feed per user (`/api/me/calendar/<token>.ics`) of their tasks' deadlines and meetings, subscribed in Outlook or Google | medium | S | no Graph needed (and no write access to calendars); works for clients too |
| 8 | **Recording fallback**: no transcript but a recording exists → download it (`OnlineMeetingRecording.Read.All`) into Phase 30's pipeline (ffmpeg to audio, our transcription) | low–medium | M | large downloads; only if transcription is often forgotten |
| 9 | Two-way sync of edits made in Outlook (event subscriptions) | low | M | Help is the source for Help-made meetings; Outlook edits are rare |

## Phasing

- **T0 – setup and spike** (owner + developer, half a day): the checklist above; a script `scripts/teams-spike.sh` (not shipped) that, with the real tenant, creates an event, resolves its join URL, lists transcripts of a test meeting, resolves a pasted classic link and a new `/meet/` link, and tries `recordAutomatically` on the event's meeting. It confirms the three things the docs leave open: the shape of `joinWebUrl` for `/meet/` links, how soon a transcript is listed after the meeting, and whether `PATCH recordAutomatically` works on calendar-backed meetings.
- **T1 – MVP** (one pull request, **built** 2026-10-18 on `feat/teams-t1`): config and Graph client; `teams_organizers`; **Create Teams meeting** (calendar event with invitations) from a meeting record; **Connect to Teams** for a pasted link; the poll job and transcript import (admins-only until shared; the notification to admins moved to T2); the Teams block states; the public **add-to-calendar** page with `.ics`, Outlook and Google links; docs (`product/knowledge-base.md`, `architecture/permissions.md`, `data-model.md`, `overview.md`, `integrations/teams.md` with the checklist, the deploy runbook, `.env.example`, ADR 0036), texts in all nine languages in the lazy `teams` and `knowledge` namespaces (the eager bundle is full); "Record and transcribe automatically" (default on) moved here from T2.
- **T2:** per-organizer transcript subscriptions with lifecycle handling and renewal (poll becomes the fallback); the "transcript ready" notification; the connect confirmation with Graph's subject; time/title sync and cancel of Help-made meetings; a client-secret expiry reminder; ideas 3 and 4.
- **T3:** idea 1 (records from the calendar), 2 (attendance), 7 (deep links); then 6 and 5 as the owner prefers.

## Decisions we took

1. Calendar events, not standalone `onlineMeetings` (transcripts are not readable otherwise).
2. Application permissions only; no per-admin Microsoft sign-in.
3. Access limited to one security group through the Teams application access policy and Exchange RBAC for Applications; no tenant-wide grants; `Calendars.ReadWrite` never consented in Entra.
4. MVP polls the known meetings; webhooks (per organizer, without resource data, so no certificate for encryption) in T2.
5. No Teams Premium; automatic recording and transcription on by default with a per-meeting toggle (owner answer 2).
6. The record stores the `onlineMeeting` id and organizer id (plus event id and `iCalUId` when Help made it); the pasted URL is only a key to look them up, its `Tid`/`Oid` only hints.
7. Invitations through Graph for the people the organizer picks (nobody preselected) plus a public add-to-calendar page with `.ics` (`UID` = `iCalUId`), Outlook/Google links and the recording notice for everyone else.
8. A transcript imported from Teams stays admins-only until an admin shares it with the client.
9. Only admins create and connect Teams meetings; connecting is an explicit action, never a side effect of saving a link.
10. Both a certificate and a client secret are supported (owner answer 5); secrets only in the server env.
11. No Graph SDK or MSAL (plain fetch and `node:crypto`), so no new dependency.
12. Teams routes are not exposed through MCP in v1.
13. (T1) The Teams fields live in `teams_meeting_links` of the teams module, keyed by the knowledge meeting; the admins-only flag on `knowledge_meetings` (owner answer 6, module boundary).
14. (T1) The organizer is always the acting admin; "not in the group" is detected from Graph's 403 on the calendar write, so no group-membership permission is requested.
15. (T1) A pasted link is resolved only through Help admins' accounts: its `Oid` must be one (else refused), otherwise each known organizer is asked; Graph's organizer and tenant are checked again.
16. (T1) The public token is derived (HMAC of `APP_SECRET`, the item and a nonce), only its hash stored, so the link can be copied again; Disconnect revokes it.
17. (T1) Every Teams route answers 404 to non-admins and while unconfigured, so the feature is invisible and inert.
18. (T1) A held transcript also holds the AI summary made from it, and a client's edit of the record never overwrites it.

## Owner answers (2026-10-18)

They replace the open questions of the draft; where they differ from a decision above, the answer wins (the sections above are updated to match).

1. **Who organises:** any eGrant colleague. Every Help admin may create a Teams meeting; the organizer is the admin who presses the button, and their Microsoft account must be a member of the organizers group ("Help – Teams organizers"). An admin who is not gets a clear error ("Your Microsoft account is not in the Help Teams organizers group").
2. **Automatic recording:** yes. Help switches "Record and transcribe automatically" **on by default** for the meetings it creates; the create dialog has a per-meeting toggle (default on).
3. **Client consent:** client contracts and the privacy notice do **not** cover recording yet. The invitation (event body) and the public calendar page carry a short notice that the call will be recorded and transcribed, in all nine languages. See [Legal](#legal).
4. **Invitees:** chosen by the organizer, never everyone automatically. The picker offers the group's people (its clients and managers) plus free email entry for people outside the group; nobody is preselected.
5. **Credential:** undecided, so **both** are supported: `TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID` and either `TEAMS_CLIENT_SECRET` or `TEAMS_CERT_PATH` + `TEAMS_CERT_THUMBPRINT`.
6. **One entity:** the Teams meeting is an **update of the existing knowledge meeting ("call") item**, not a new entity. The Teams fields live in a small table `teams_meeting_links` keyed by the meeting item (see [Data model](#data-model-migration-0048)); the user-facing object stays the knowledge call.
7. **Public page:** the owner accepted that anyone with the link sees the title, the time and the join link.

Still open (not needed for T1): transcript visibility stays our default (admins-only until shared); matching rule for automatic records (idea 1); `meetingSpokenLanguageTag`; the order of the ranked ideas.

## Legal

**For the owner, not decided here:** client contracts and eGrant's privacy notice must be updated to cover recording and transcribing client calls (purpose, legal basis, retention of recordings in the organizer's OneDrive and of transcripts in Help, who can see them). Until then Help only adds the notice to the invitation and the public page; it does not replace consent or information duties. Nothing in this design takes a legal position.

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
