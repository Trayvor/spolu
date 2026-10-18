# 0037 eGrant groups webhook (JSON logo, no image library) and group deactivation by a database guard

Date: 2026-10-18
Status: accepted

## Context
Admins created every client group in the app. eGrant knows its instances (client organisations), so it should create and update the groups itself (`PUT /api/egrant/groups`), logo included. The owner also asked for group **deactivation**, in the app and through the same call: a deactivated group vanishes for its clients and requesters, is hidden from admin lists and becomes read-only, and reactivating it brings everything back. Two technical questions came with it:

1. How the logo travels and how it is cleaned. The other eGrant calls are JSON with one Bearer key; the in-app logo upload stores the bytes as uploaded (no image library in the server).
2. How "nothing new is created in a deactivated group" is enforced. Writes into a group go through dozens of routes in ten modules, many keyed by an item id (`/tasks/:id`, `/messages/:id`), plus jobs and integrations.

## Decision
- **The logo is base64 in the JSON body** (`{ content_type, data_base64 }`, at most 2 MiB decoded, body limit 3 MiB for this route only), so eGrant needs no multipart. The declared type must be PNG, JPEG or WebP (`415`; SVG never, it can carry scripts) and the bytes must sniff as that type (`422`).
- **Metadata is stripped by walking the file structure, without decoding** (`modules/groups/logo-metadata.ts`): PNG text, EXIF and time chunks, JPEG APP1 (EXIF, XMP), APP13 (IPTC), other APPn but JFIF, ICC and Adobe, and comments, WebP EXIF and XMP chunks (with their VP8X flags), and every byte after the image's end. A broken structure is refused. No image library (sharp and similar are native and large); the logo is not resized, which the 2 MiB limit makes acceptable. The in-app upload is unchanged.
- **Its own optional key**: `EGRANT_GROUPS_API_KEY`, falling back to `TICKETS_API_KEY` (`egrantGroupsKey` in the config), checked 503, 429, 401 before the body like the managers webhook. Creating groups is a stronger power than sending tickets, so it may be split off later without a code change.
- **Deactivation is a nullable `groups.deactivated_at`** (migration 0049). Nothing is deleted. One service, `setGroupActive` (`modules/groups/deactivation.ts`), serves the app's buttons and the webhook: it sets the column, drops the group's pending notifications, moves its clients' sockets out of (or back into) its room and emits `group:status`.
- **Access goes through the membership readers**: `clientGroupIds`, `activeRolesIn`, `listMemberships` and the membership SQL helpers ignore memberships of a deactivated group, so every module's existing `canReadGroup` / ticket checks answer 404 to its clients and requesters with no change in the modules.
- **"Read-only" is a database guard**: `BEFORE INSERT` triggers on messages, tasks, buckets, tickets (and `UPDATE OF group_id`), knowledge items and folders, projects, project events and reminder sets raise SQLSTATE `SPG01` when the row's group is deactivated; the app's error handler maps it to `409 group_inactive`. One guard covers every route, job and integration, present and future. Edits of existing rows are not blocked (admins may still close a task or resolve a ticket). Finance and files have no guard: late invoices of a former client must still be recorded.
- **Only explicit deactivation**: nothing in Help (finance contract dates, inactivity) changes the state; eGrant sends `active: false` only for an operator's explicit closing of an instance.

## Consequences
- A future table holding group content needs its own trigger in its migration; `docs/product/groups.md` lists the guarded tables.
- The guard costs one indexed lookup of `groups` per insert into those tables.
- A write that is refused surfaces as `409 group_inactive` wherever it happens, also inside a transaction of another module; the web shows its generic error for it.
- Logos from eGrant may be up to 2 MiB and are served as they are (after cleaning); the in-app limit stays 512 KiB.
