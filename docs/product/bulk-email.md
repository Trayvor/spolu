# Bulk email

Every administrator can write an email to many people in Spolu at once ("Hromadné e-maily", en "Bulk email"). Clients and requesters (ziadatel) never see the module. Design: [Phase 23 spec](../superpowers/specs/2026-10-16-phase-23-bulk-email-design.md); plan: [Phase 23 plan](../superpowers/plans/2026-10-16-phase-23-bulk-email.md).

## What admins can do

- **Campaigns.** A campaign is an email with an internal name, a subject, a preheader (the hidden preview line), up to 50 blocks (heading, text, image, button, divider, eGrant logo) and an audience. States: `draft` → `sending` → `sent`, or `sending` → `cancelled`.
- **Drafts.** A new campaign is a draft with only its name, an empty audience and no blocks. Any admin edits any draft; edits are saved with the `version` read last, so when two admins edit the same draft the later save is refused (`409 changed`) and the editor offers to reload. Only a draft can be edited or deleted (`409 not_draft` otherwise).
- **Duplicate.** Any campaign, also a sent or cancelled one, can be duplicated into a new draft with the same subject, preheader, blocks and audience, version 1, named "<name> (kópia)" / "<name> (copy)" in the admin's language.
- **List.** All campaigns, last changed first, 50 a page, with status, counts (queued, sending, sent, failed, skipped, cancelled, unsubscribed through this campaign's link), author and dates.
- **Ready to send.** A campaign can be tested or sent only with a subject, at least one block, every image still uploaded and every button and image link valid; otherwise the answer is `400 not_ready` with a list of `{ blockId?, problem }` (`subject_missing`, `no_blocks`, `image_missing`, `invalid_url`) that the editor shows at the block.
- **Test send.** "Send a test to me" sends the campaign as it is saved now to the signed-in admin's own address only (never another address), rendered with their name and language, the subject prefixed `[Test] `, through the same bulk sender and From. Any state can be tested. The unsubscribe link of a test email carries the campaign id `test`, so it changes nothing. 10 tests a minute per admin (`429 rate_limited`).
- **Send.** Sending a draft freezes the recipient list (the audience at that moment, minus disabled and unsubscribed people; each person's email, name and language are copied), sets `sending` with the sender address, the recipient count, who sent it and when, and starts the queue. With nobody to send to the answer is `400 empty_audience` and the campaign stays a draft. Two admins pressing Send at once: one starts it, the other gets `409 not_draft`.
- **Sending speed.** The queue sends 20 people per run, one email per person, and spaces the runs so that at most `BULK_EMAIL_PER_MINUTE` (default 120) go out a minute: a run every 10 s, about 8 minutes for 1 000 people. Before each person's turn Spolu checks again: a person who unsubscribed or was disabled after the send started is **skipped** (`error` `unsubscribed` or `disabled`), never sent. A temporary provider error (network, timeout, `409`, `429`, `5xx`) is retried up to 3 attempts in later runs, then **failed**; any other provider error is failed at once with the provider's message. Each email has a stable key per campaign and person, so a crash or retry never mails anyone twice. When nobody is left in the queue the campaign becomes **sent**. A daily sweep (04:15) fails rows stuck in sending for 20 hours (`unknown`) and restarts a campaign whose queue was lost.
- **Cancel.** "Cancel sending" on a sending campaign sets it `cancelled` and every person still queued `cancelled`; emails already on their way finish. Any other state: `409 not_sending`.
- **Report.** The campaign (`GET …/:id`) carries the counts: recipients (`recipientCount`), queued, sending, sent, failed, skipped, cancelled and unsubscribed through this campaign's link; the per-person list (name, email, status, error, sent time) is 50 a page by name with a status filter. "Sent" means the provider accepted the email; opens and clicks are not measured.

## Blocks and images

An email is at most 50 blocks, in the order the admin puts them; admins choose content and order only, never colours or fonts (the look is fixed, see [design/README.md](../design/README.md#bulk-email-look)).

| block | content | limits and rules |
|---|---|---|
| heading | one line of text, left or centred | at most 200 characters; `{{name}}` becomes each person's name |
| text | paragraphs, left or centred | at most 5 000 characters; a blank line starts a paragraph, a single newline breaks the line, `**bold**` is bold, `http(s)://` addresses become links; `{{name}}` becomes each person's name |
| image | an uploaded PNG or JPEG, a description (alt) and an optional link | the browser shrinks it to at most 1 200 px wide (JPEG, a PNG stays PNG) before the upload; the upload is at most 2 MB; the alt is required, at most 200 characters; the link is `http(s)://` only. Shown at its own width, at most the 520 px column |
| button | a label and a link, left or centred | label at most 60 characters; link `http(s)://` or `mailto:<address>` |
| divider | a thin line | — |
| eGrant logo | the egrant logo (PNG, 180 px wide) | — |

- Name, subject and preview line are at most 200 characters each; the subject is needed only to test or send.
- Only `{{name}}` is a merge field (owner answer P2); any other `{{…}}` stays as typed. Everything an admin types is escaped, so markup or scripts never reach the email, and a link that is not `http(s)` (or `mailto:` on a button) is refused when saving (`400 validation_failed`).
- **Images are public by URL**: `<PUBLIC_URL>/api/bulk-email/images/<id>`, a random id, no login, because mail apps load them from their own servers. They stay as long as the server does, so a sent email keeps showing them. Do not upload anything that must stay private.
- Every email ends with a footer in the person's language (any of the nine UI languages): why they get it and the unsubscribe link. The plain-text part carries the same content.

## Screens

The header link "Hromadné e-maily" / "Bulk email" (beside Admins; in the section menu where the links do not fit) is shown to admins only; a client who opens `/bulk-email` gets the not-found page.

- **`/bulk-email`**: the list of emails, last changed first, 50 a page with "Show more": internal name, status badge (Draft, Sending, Sent, Cancelled), subject, "248 sent, 2 failed" for an email past its draft, author and the last change. **New email** creates a draft named "Email of <date and time>" / "E-mail z <…>" and opens it; the name can be changed in the editor. The list refreshes on `bulk:updated`.
- **`/bulk-email/<id>`, a draft**: four numbered sections on one page.
  1. **Content**: internal name, subject, preview line, then the blocks and the preview (side by side when the page is wide enough, the preview below the blocks otherwise). Each block has its form, **Move up**, **Move down** (not on the first or last block) and **Delete**; **Add block** offers the six types (at most 50 blocks). Heading and text accept `{{name}}`. An image is shrunk in the browser to at most 1 200 px wide, as JPEG (PNG stays PNG), before the upload, and needs a description (alt); a button needs a link (`https://…` or `mailto:`). A field the server would refuse is marked at once with the reason. The **preview** is the server's rendering in a sandboxed frame (no scripts) with a **Computer** (600 px) / **Phone** (375 px) switch, refreshed 500 ms after the last edit, with the signed-in admin's name; blocks with problems are left out of it until fixed.
  2. **Recipients**: roles (Clients, Requesters, Admins), the groups managed by chosen admins, client groups (with a search; none ticked = every group), **Add a person** and **Leave out a person** (search by name or email; adding a person to one list removes them from the other), and the live count ("248 people get this email", asked 300 ms after the last change) with the left-out numbers (unsubscribed, disabled) and **Show recipients** (a dialog, 50 a page).
  3. **Test**: **Send a test to me** sends the email as saved to the signed-in admin's own address and says where it went. It is disabled while changes are not saved yet. Reasons the email is not ready (`400 not_ready`) show at their block (or under the button for the subject and "no blocks"); 10 tests a minute (`429`) shows a wait message. (A server without the test route answers its generic 404; the button then gives way to "Test sending is not available on this server yet".)
  4. **Send**: **Send…** first saves any change still waiting (skipping the 1 s wait), then opens a dialog "Send to 248 people?" with the subject, the sender address (`GET /api/bulk-email/sender`) and the recipient count asked again at that moment. **Send to 248 people** starts sending and the page turns into the report; **Not now** closes the dialog. When the email is not ready (`400 not_ready`) the dialog closes and the reasons show at their block, as for the test; nobody to send to (`400 empty_audience`, or a count of 0) and "sending already started" (`409 not_draft`, with **Show the report**) are told in the dialog. The button is disabled while a field is marked (an unsaved draft cannot be sent).

  **Saving** is automatic, 1 s after the last change, with the `version` read last; the status line says "All changes saved", "Saving…", "Not saved: fix the marked fields" or "Not saved. Check your connection." (with Try again). When another admin saved first (`409 changed`) or sending started (`409 not_draft`) the editor stops saving, says so, and offers **Reload**, which loads the server's version; it never overwrites the other edit. When another admin saves while nothing waits to be saved here, the editor takes their version at once. A pending change is saved when the editor is left. **Delete draft** asks first.
- **`/bulk-email/<id>`, sending, sent or cancelled**: the report, read-only. Status badge, subject, "Sending started <date> by <admin>, from <sender>" and the finish time; the numbers **Recipients**, **Sent**, **Failed**, **Skipped** (unsubscribed or disabled before their turn), **Cancelled** and **Unsubscribed** (through this email's link, still unsubscribed); while sending a progress bar "120 of 248 handled" (sent, failed, skipped and cancelled people over the recipients); the note "Spolu does not measure opens and clicks yet. 'Sent' means Elastic Email accepted the email, not that it reached the inbox." Below, **People**: every recipient by name with email, status (Waiting, Sending, Sent, Failed, Skipped, Cancelled), the reason (Unsubscribed, Account disabled, Unknown result, or the provider's message) and the sent time, 50 a page with **Show more**, and a **Show** filter by status. Everything refreshes on `bulk:updated`, so the numbers and the list move while the email goes out. **Cancel sending** (only while sending) asks first ("Stop sending? People who have not got the email yet will not get it."); if sending finished meanwhile it says so. **Duplicate** opens a new draft with the same content and audience.

## Audience rules

The audience is a filter stored on the campaign (`BulkAudience`): `groupIds`, `managerIds`, `roles` (`client`, `ziadatel`, `admin`), `includeUserIds`, `excludeUserIds`, each list at most 500 ids.

1. The **group scope** is the picked groups plus the groups managed by the picked managers. With no groups and no managers picked, the scope is every group. A picked manager who manages no group adds nothing.
2. `client` and `ziadatel` take the people with an active membership (not removed) of that role in a group of the scope. With no role ticked nobody comes from the groups.
3. `admin` takes every admin and superadmin; the group scope does not apply to them.
4. People added by hand are always in; people left out by hand are always out (also when added by hand). Everyone counts once, however many ways they match.
5. Then **left out**, and counted per reason: disabled accounts, and people who unsubscribed. A disabled person who also unsubscribed counts as disabled. People who never signed in (invited, or requesters who never used a code) are **included** (owner answer P1). A person who subscribed again is included.

The builder shows the live count with the "left out" numbers, and "Show recipients" lists the people who would get it (name, email, role, their groups), 50 a page by name. "Add a person" and "Leave out a person" search active people by name or email (at least 2 characters, 20 results). The list is frozen when sending starts.

## API (admins only; clients 403, no session 401)

| route | does |
|---|---|
| `GET /api/bulk-email/campaigns?cursor=` | the list (`BulkCampaignPage`) |
| `POST /api/bulk-email/campaigns` | `{ name }` → 201, a new draft (`BulkCampaignDto`) |
| `GET /api/bulk-email/campaigns/:id` | the campaign with its counts; 404 if unknown |
| `PUT /api/bulk-email/campaigns/:id` | save a draft (`BulkCampaignDraftSchema`, body ≤ 200 kB, else 413); 400 `validation_failed`, 404, 409 `not_draft` (wins over a stale version), 409 `changed` |
| `DELETE /api/bulk-email/campaigns/:id` | 204; 404; 409 `not_draft` |
| `POST /api/bulk-email/campaigns/:id/duplicate` | 201 with the new draft; 404 |
| `GET /api/bulk-email/sender` | `{ sender }` (`BulkSenderDto`): the From address bulk email goes out with (`MAIL_FROM_BULK`), for the send dialog |
| `POST /api/bulk-email/campaigns/:id/test` | 202 `{ to }` (the admin's own address; `BulkTestSendResult`), the test is queued; 400 `not_ready` with `problems` (`BulkNotReadyAnswer`); 404; 429 `rate_limited` after 10 a minute |
| `POST /api/bulk-email/campaigns/:id/send` | 200 with the campaign (`BulkCampaignDto`, `sending`, or already `sent` when the first run finished at once); 400 `not_ready` with `problems`; 400 `empty_audience`; 404; 409 `not_draft` |
| `POST /api/bulk-email/campaigns/:id/cancel` | 200 with the campaign (`cancelled`); 404; 409 `not_sending` |
| `GET /api/bulk-email/campaigns/:id/recipients?status=&cursor=` | `BulkRecipientPage` = `{ items: BulkRecipientItem[], nextCursor }`, 50 a page by name, `status` one of the recipient statuses; 400 `validation_failed` for a bad status or cursor; 404 |
| `POST /api/bulk-email/audience/count` | `BulkAudience` → `{ count, leftOut: { unsubscribed, disabled } }` |
| `POST /api/bulk-email/audience/people?cursor=` | `BulkAudience` → `{ items: BulkPerson[], nextCursor }` |
| `GET /api/bulk-email/people?q=` | people search (`BulkPerson[]`, 2–200 characters) |
| `POST /api/bulk-email/people/lookup` | `{ ids }` (≤ 1 000) → the people behind saved ids, disabled ones too, unknown ids left out (the editor shows the people added or left out by hand) |

A malformed `cursor` is `400 validation_failed`. Every write, every send state change and every batch run pushes `bulk:updated { campaignId }` to the admins room.

## Unsubscribing and subscribing again (part 23.4)

Spolu is the source of truth (owner answer P3). Every person is subscribed until they unsubscribe; people who never signed in too.

- **The link.** Every bulk email's footer link and its `List-Unsubscribe` header lead to Spolu with a signed token for that person and campaign (`<userId>.<campaignId>.<signature>`; nothing is stored, rotating `APP_SECRET` invalidates old links). The page `/unsubscribe/<token>` needs no login. When it opens it unsubscribes the person and says "You will no longer get bulk emails from eGrant. Login codes and notifications from Spolu still arrive.", with **Subscribe again** (and, after that, **Unsubscribe** again). It is shown in the person's language. A link scanner that only fetches the page changes nothing (the page's script does the unsubscribe). A broken or forged link shows "This link is not valid"; the link of a test email shows "This was a test email; nothing changed." The page never shows the person's name or address.
- **One-click.** Mail apps that offer "Unsubscribe" next to the sender (RFC 8058) post to `/api/bulk-email/unsubscribe/<token>/one-click`; it works from the provider's servers, whatever the body.
- **Settings.** Every signed-in person (admins, clients and requesters) has the checkbox **"Dostávať hromadné e-maily" / "Receive mailings"** in the Profile card of Settings, ticked by default; unticking unsubscribes, ticking subscribes again (owner answer P4). It saves at once and says "Saved".
- **Effect.** An unsubscribed person is left out of the audience count and of every later send (a running send checks again before each person's turn and skips them). The campaign's "unsubscribed" count is the people whose current setting is unsubscribed through that campaign's link. **Only bulk email is affected**: login codes, invites, notifications and ticket emails always arrive (P5).
- **Elastic Email.** Until Elastic's support removes its forced unsubscribe link (`BULK_EMAIL_UNSUBSCRIBE=elastic`, the default), the footer link passes through Elastic, which also suppresses the address; when the person subscribes again in Spolu, Spolu asks Elastic to drop that suppression (best effort, not documented to work for unsubscribes). In `spolu` mode Elastic records nothing and no call is made. With `BULK_EMAIL_DRIVER=elastic` a daily job at 04:30 copies the unsubscribes and complaints recorded on Elastic's side into Spolu (source `provider`), but never over a change the person made in Spolu after Elastic's date: it is only a safety net.

| route | does |
|---|---|
| `GET /api/bulk-email/unsubscribe/:token` | public: `{ language, subscribed, test }`; 404 for a bad link |
| `POST /api/bulk-email/unsubscribe/:token` | public: unsubscribe (source `link`), 204 |
| `POST /api/bulk-email/unsubscribe/:token/one-click` | public: the same with source `one_click`, any body, 204 |
| `POST /api/bulk-email/subscribe/:token` | public: subscribe again, 204 |
| `GET /api/me/bulk-email` | signed in: `{ subscribed }` |
| `PUT /api/me/bulk-email` | signed in: `{ subscribed }` → 204 (source `profile`) |

The public routes allow 30 calls a minute per IP (`429 rate_limited`); all of them are idempotent.

## Status

Phase 23 is built and tested locally (`done (local)` in the [roadmap](../roadmap.md)), all seven parts, with the end-to-end test `e2e/bulk-email.spec.ts` (write, test, send, report, unsubscribe through the link and the one-click header, Settings, subscribe again) against Mailpit. Before the first real send the owner sets up Elastic Email: see the pre-launch checklist in [runbooks/deploy.md](../runbooks/deploy.md#bulk-email-pre-launch-checklist).
