# 0017 Ticket intake files as base64 in the JSON body

Date: 2026-10-16
Status: accepted

## Context
The first ticket intake (Phase 21) took `file_links`: external URLs Spolu showed but never downloaded. The links broke when eGrant moved or protected the files, the requester could not open them, and the AI task split saw only their names. The owner decided (2026-10-16) that eGrant sends the files themselves, and that `file_links` goes away completely (API, form, DTO, database; the data was test data only).

## Decision
- The intake keeps one JSON request: `files` is an array of up to 10 `{ name, content_base64, content_type? }`. No multipart endpoint and no second upload call, so eGrant's retry with `request_id` stays one idempotent request.
- Limits: 10 MiB per file and 20 MiB per request decoded; the intake route alone raises Fastify's body limit to 28 MiB (base64 adds a third), every other route keeps 1 MiB. The key and the rate limit are checked in `onRequest`, before the body is read. A repeated `request_id` answers `200` before any file is decoded.
- Base64 is strict (standard alphabet, padding, no whitespace). The type is sniffed from the bytes against an allowlist (`sniffAllowedType` in the files module: images, PDF, Office/OpenDocument/ZIP by container plus extension, RTF, UTF-8 text); `content_type` is informational. Normal uploads keep accepting any type (they are served as attachments with `nosniff`); an unattended integration gets the stricter list.
- Files are stored through the files module (`createReceivedFile`) before the ticket's transaction, which attaches them (`attachReceivedFiles`, `ticket_attachments` with a `position`); any failure or a lost `request_id` race deletes them, and the daily unattached cleanup is the net.
- `files.group_id` and `files.uploaded_by` become nullable: a received file has no uploader, and a ticket without a client keeps its files in no group (admins only) until a client is assigned; they then move with the ticket like the form's files. Migration 0023 also drops `tickets.file_links`.

## Consequences
- The requester and the client's people download the files from the ticket; the AI split gets their names like uploaded files.
- One intake request can hold about 28 MiB in memory (the parsed body plus up to 20 MiB of decoded bytes); 60 requests a minute per address bounds it.
- Code reading `files.group_id` must handle null (`canReadFile` answers admins only; `getFilesForGroup(db, null, ids)`).
- An old client that still sends `file_links` gets them ignored, like any unknown field.
