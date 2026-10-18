# 0023 A static ffmpeg build for meeting audio, and speech-to-text over plain fetch

Date: 2026-10-17
Status: accepted

## Context
Phase 30 ([spec](../superpowers/specs/2026-10-17-knowledge-meetings-design.md)) keeps a meeting's recording on our server as audio only: an upload of audio or video (up to 2 GB) is transcoded to compact speech audio and the original is deleted; for the AI summary the audio is split into parts small enough for one speech-to-text request. Both need ffmpeg, which the production image (`node:24-bookworm-slim`) does not have. The owner asked to keep the image lean.

Measured on the base image (uncompressed layer size):
- Debian's `ffmpeg` package with `--no-install-recommends`: **+406 MB** (it pulls the codec, X11, VA-API and Mesa libraries).
- One static ffmpeg binary from `mwader/static-ffmpeg:7.1.1` (multi-arch amd64/arm64, built from source by a public, widely used MIT-licensed build): **+104 MB**, no shared libraries, no ffprobe. It has the native AAC encoder we use and libopus.

## Decision
- **ffmpeg** is copied into the runtime image from a pinned static build: `COPY --from=mwader/static-ffmpeg:7.1.1 /ffmpeg /usr/local/bin/ffmpeg` (`ARG FFMPEG_IMAGE`, so the tag can be bumped or replaced by a digest). The server runs it as a child process (`infra/media/media.ts`), never through a shell, with fixed arguments and a 2-hour kill timer; `FFMPEG_PATH` points elsewhere for local development.
- **Format**: AAC-LC mono, 16 kHz, 32 kbps in `.m4a` (about 14 MB an hour). Safari, Chrome and Firefox play it in `<audio>`, and OpenAI's and ElevenLabs's speech-to-text accept it, so nothing converts it again. Opus would be a little smaller, but OpenAI's transcription does not list `ogg` and older Safari does not play it.
- **Splitting** for transcription: ffmpeg's segment muxer with `-c copy` into 20-minute parts (about 5 MB each), under OpenAI's 25 MB request limit and its duration limits.
- **Speech-to-text providers over plain `fetch`** (no SDK, like the task split): `TranscriptionProvider` with OpenAI (`/v1/audio/transcriptions`, model `gpt-transcribe` by default), ElevenLabs Scribe (`/v1/speech-to-text`, `scribe_v2`) and a fake for dev and e2e, chosen by one line, `TRANSCRIPTION_PROVIDER`.

## Consequences
- The image grows by the ffmpeg binary (a 104 MB layer). Measured 2026-10-17 on the slim runtime image (PR #57) with ffmpeg: 535 MB on disk and 133 MB compressed content, against 380 MB and 82.8 MB without it (see [performance](../architecture/performance.md), "Docker image"). Security updates of ffmpeg come by bumping the pinned tag, not by `apt`; the tag is reviewed with the Node base image. Since 2026-10-18 the image is `mwader/static-ffmpeg:8.1.2`, pinned by digest, and run with input whitelists and a minimal environment ([ADR 0041](0041-ffmpeg-hardened-for-untrusted-uploads.md)).
- A transcode uses one CPU for a few minutes per hour of recording; the job queue runs one at a time.
- Without ffmpeg (a dev machine without it), uploads end as "failed"; the rest of the app is unaffected. Tests use a fake `MediaTools`; the real ffmpeg test runs only where ffmpeg is installed.
- 2026-10-18: the image is now pinned by digest as well ([ADR 0037](0037-supply-chain-policy.md)).
