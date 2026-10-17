# Phase 30 — Knowledge: meetings with AI summary (design)

Status: self-approved under the owner's go of 2026-10-17 (the owner set the decisions in the brief; the defaults below are ours and listed under "Decisions we took").

## Goal

A new knowledge item type **Meeting** (sk "Stretnutie", pl. "Stretnutia") that keeps everything about one meeting or call in the group's knowledge base: when it is, the links (meeting, recording, transcript), a compact audio copy of the recording kept on our server, the transcript and notes. Admins turn it into a structured summary with one button ("Spracovať s AI"), and turn the summary's action items into tasks through the existing review dialog. A dashboard card lists the coming meetings and the past ones still without a summary.

## The item

- Fields: title (required), date and time (`startsAt`, required), meeting link, recording link, transcript link (each an optional http(s) URL), transcript text (paste, or upload a `.txt`, `.vtt`, `.srt` or `.docx` file whose text is extracted into the field), notes (the item's formatted `body`), an optional recording file, an optional reminder.
- It lives like the other hand-made types: folders, search, "+ New", the type pills, the global list, the existing visibility ("Everyone in the group" / "Only eGrant"; a client's meeting stays public; an admins-only folder makes it admins-only). Clients of the group see a public meeting with its transcript and summary.
- Edit and delete: the author and admins, as for the other types. Deleting it deletes its recording file and any upload still waiting.
- **Reminder:** optional. The form has the reminder times and recipients (the reminders module, unchanged); a new meeting proposes one time 15 minutes before it. No times means no reminder.
- **List row:** a camera tile, the title, then the meeting's date and time (in the viewer's language, Bratislava time) and a state badge: "Processing" while a recording is transcoded or the AI runs, "Summary" when there is one.
- **Search** covers title, notes, the three links, the recording's file name and the summary's text. The transcript is not searched (it can be very long; the trigram index would grow by its size).

### Storage

- `knowledge_meetings`: one row per meeting item (`item_id` primary key, cascades with the item) with `starts_at`, the three URLs, `transcript` (≤ 400 000 characters), `transcript_source` (`manual` or `ai`), the recording state (`none`, `processing`, `ready`, `failed`), `recording_file_id` (the compact audio, a `files` row), `upload_key` (the original upload while it waits for the transcoder), the AI state and the summary (`jsonb`). Index on `starts_at` for the dashboard.
- The compact audio is a normal file of the group, attached to the item through `knowledge_attachments`, so it follows the item's visibility (admins-only flag) exactly like a note's files, and `GET /api/files/:id` serves it. That route now answers single `Range` requests (206) so Safari can play and seek audio.

## Recording upload and transcoding

- `POST /api/knowledge/:id/recording`: the raw file as the body (like `POST /api/groups/:id/files`), the editors of the item, at most 2 GB, streamed to storage (`meeting-uploads/<item>/<uuid>`), never buffered. 10 uploads an hour per user. The declared type must be `audio/*` or `video/*` (or `application/octet-stream` with a media file extension); otherwise 400 `invalid_recording`. The meeting goes to `processing` and a job `knowledge.meeting-transcode` is sent. An upload while one is processing answers 409 `recording_busy`.
- The job runs ffmpeg on the upload: `-vn -ac 1 -ar 16000 -c:a aac -b:a 32k -movflags +faststart`, an `.m4a` (AAC-LC mono, 32 kbps: about 14 MB an hour). Speech stays clear, the browser plays it everywhere (Safari included), and OpenAI accepts `m4a`. Only the result is stored (a new file, `<title>.m4a`); the original upload is deleted, also when transcoding fails. A previous recording is replaced (its file deleted after the new one is attached).
- Errors: three attempts a minute apart, then `failed` with "The recording could not be processed." and the upload deleted; the editor can upload again. pg-boss's own retry covers a crash mid-job (`expireInSeconds` 2 h).
- ffmpeg runs as a child process (`FFMPEG_PATH`, default `ffmpeg`), never through a shell; one transcode at a time (queue concurrency 1).
- `DELETE /api/knowledge/:id/recording` removes the stored audio (editors).
- Video is never kept: only the external recording link points at it.

### Docker image

ffmpeg comes from a pinned static build (`COPY --from=mwader/static-ffmpeg:7.1.1 /ffmpeg /usr/local/bin/ffmpeg`): +104 MB uncompressed, against +406 MB for Debian's `ffmpeg` package with `--no-install-recommends`. No ffprobe. See [ADR 0023](../../decisions/0023-ffmpeg-static-build-for-meeting-audio.md).

## AI processing ("Spracovať s AI", admins only)

`POST /api/knowledge/:id/meeting/process` (admins; a client gets 403, an unreadable item 404):

1. Refuses when nothing can be processed: no transcript and no ready recording (400 `nothing_to_process`); a transcript is needed and no transcription provider is configured, or no summary AI (503 `ai_unavailable`); a run already queued or running (409 `meeting_busy`, one run per item at a time by a conditional update); more than 20 runs an hour by this admin (429).
2. Sets the state `queued` and sends `knowledge.meeting-ai`.
3. The job: without a transcript, `transcribing`: the stored audio is split by ffmpeg into 20-minute segments (`-f segment -c copy`, under OpenAI's 25 MB per request and its duration limit), each segment is transcribed in order, the texts joined with blank lines and stored as the transcript (`transcript_source` `ai`). Then `summarizing`: the transcript (cut to 300 000 characters) goes to the LLM, which returns the summary; `done`.
4. Failures: three attempts a minute apart (a transcript already made is kept, so a retry only summarizes), then `failed` with the reason code (`transcription_failed`, `summary_failed`); "Try again" starts a new run.
5. Every state change bumps the item's `updated_at` and sends `knowledge:item`, so open lists and the open dialog refresh; the dialog also polls every 5 s while a run or a transcode is in progress (the global list has no live events).

### Transcription providers

`TranscriptionProvider.transcribe({ audio, fileName, mime }, signal) → { text }` in `modules/ai/transcription.ts`:

- `openai`: `POST /v1/audio/transcriptions`, multipart, model `OPENAI_TRANSCRIBE_MODEL` (default `gpt-transcribe`, OpenAI's recommended model for recorded speech in its original language; `gpt-4o-mini-transcribe` is the cheaper choice). The language is detected by the model (no hint: groups have no language of their own and meetings mix Slovak, Czech and English). Uses `OPENAI_API_KEY`.
- `elevenlabs`: `POST https://api.elevenlabs.io/v1/speech-to-text`, header `xi-api-key`, `model_id` `ELEVENLABS_STT_MODEL` (default `scribe_v2`). Plain fetch, no SDK. `TRANSCRIPTION_PROVIDER=elevenlabs` without `ELEVENLABS_API_KEY` stops the server at start (config error).
- `fake` (dev and e2e, refused in production unless `AI_ALLOW_FAKE=1`): a fixed Slovak/English sample transcript with a decision, two action items and a question.

Switching is one line: `TRANSCRIPTION_PROVIDER=openai|elevenlabs|fake` (default `openai`, which is off without `OPENAI_API_KEY`). Error bodies are never read or logged (they may echo a key); transcript text is never logged.

### Summary

`MeetingSummaryProvider.summarize({ title, startsAt, transcript, notes, people }, signal)`: Chat Completions with a strict JSON schema, model `OPENAI_MODEL` (the task split's), through the existing OpenAI key; a fake for `AI_PROVIDER=fake`. The result, stored on the item and editable by the item's editors:

```ts
{ summary: string;                 // a short paragraph, ≤ 2000 characters
  decisions: string[];             // ≤ 30, each ≤ 500
  actionItems: { text: string; assignee: string | null; deadline: string | null }[]; // ≤ 30
  openQuestions: string[];         // ≤ 30
  language: string | null }        // the transcript's language (ISO 639-1), informational
```

`assignee` is a name only when the meeting names who does it; `deadline` is `YYYY-MM-DD` only when it is said. **Language:** the transcript's language (the model writes in it). A meeting is shared with the client, so its summary should read in the language that was spoken, not in the language of the admin who pressed the button.

## Action items → tasks

- "Vytvoriť úlohy" (admins, when the summary has action items) opens the existing task review dialog with a new source `meeting`.
- `POST /api/knowledge/:id/meeting/task-proposals` turns the action items into proposals without another AI call: the title is the text (cut to 200), the description the text when it is longer plus "From the meeting <title>, <date>"; the suggested assignee is matched to the group's pickable people by name (case and diacritics ignored, a unique full or first-name match only); the deadline when it is a real date.
- The review is the same (edit, approve, reject). New for this source: a **bucket** select (the group's buckets except Completed, default To do) above "Create N tasks".
- `POST /api/knowledge/:id/meeting/tasks` (`{ bucketId?, tasks }`, admins) creates the approved cards at the top of the chosen bucket through `createTasksFromSource` (now taking an optional bucket), all or none, and pushes the board events. No source link on the task yet (later).

## Dashboard card "Meetings"

`GET /api/me/home/meetings` (admins): meetings of the clients the admin manages (all clients when they manage none, as the global knowledge list) that start in the next 7 days (soonest first, up to 10, with the count), then past meetings of the last 30 days without a summary (newest first, up to 10, with the count). Admins read every item, admins-only ones too. The card sits as a wide card under "My tasks" (the Tickets card stays first, PR #35); rows show the date and time, the client and the title, past ones with a "No summary" badge, and open the item in its group's Knowledge tab. On phones it is one more count tile.

## Transcript files

`POST /api/knowledge/transcript-text` (any signed-in user, 30 a minute): the raw file (≤ 10 MB) with `x-file-name`; returns `{ text }` and stores nothing. `.txt` as UTF-8; `.vtt` and `.srt` without the header, cue numbers and timing lines (`NOTE` blocks and tags dropped, a speaker's `<v Name>` kept as "Name: "); `.docx` read with Node's zlib from the zip's `word/document.xml` (no new dependency), one line per paragraph. Anything else 400 `invalid_transcript_file`.

## Decisions we took

1. Clients may create meetings and upload recordings to their own (they are editors), like the other types; only the AI run and "Create tasks" are admins-only.
2. The transcript is not part of search.
3. Summary language: the transcript's language.
4. No language hint for transcription (auto-detect).
5. AAC/m4a at 32 kbps mono rather than Opus: Safari and OpenAI both take it without conversion.
6. Static ffmpeg build (ADR 0023).
7. Per-admin limit: 20 AI runs an hour; recording uploads 10 an hour per user.
8. The dashboard card follows the managed-clients scope of the global knowledge list.
9. The job status bumps `updated_at`: an edit open during a run may get "changed meanwhile" and reload.

## Later

Speaker labels (diarization), a task's link back to its meeting, re-summarizing only a part, calendar invites from the meeting.
