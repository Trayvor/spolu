# 0048 ffmpeg runs in a media sandbox container, reached over a Unix socket

Date: 2026-10-18
Status: accepted

## Context
[ADR 0041](0041-ffmpeg-hardened-for-untrusted-uploads.md) hardened ffmpeg inside the app container (input whitelists, an environment with only `PATH`, thread and allocation caps, ffmpeg 8.1.2). It left the follow-up of the security review, M3 point 3: a crafted upload that hits a demuxer memory-safety bug still runs code as the app's user, in the app's container. There it can read `/proc/<node pid>/environ` (`APP_SECRET`, `DATABASE_URL`, every API key), every stored file under `/data/files`, and reach PostgreSQL and the internet.

Options considered:
- **`docker run` per job.** Strong isolation, but the app would need the Docker socket, which is root on the host. Refused.
- **A transcoding service on the Docker network (HTTP over TCP).** Works, but the service then has a network, and an `internal: true` network still lets it reach the app and anything else on that network.
- **A transcoding service with no network at all, reached over a Unix socket on a volume shared with the app.** The chosen one.

## Decision
A `media` service in `deploy/docker-compose.yml` runs ffmpeg. It uses **the same image** as the app with its own entry point, `node server/media-sandbox.js` (`apps/server/src/media-sandbox.ts`, built by tsup next to `main.js`), so there is no second image to build, push, pin or load (`build-image.sh` and `deploy-local.sh` are unchanged; the `IMAGE_PRELOADED` pull in `deploy.sh` skips `media` like `app`).

The container: `network_mode: none` (only loopback), `read_only: true` with a 16 MB `/tmp` tmpfs, `cap_drop: [ALL]`, `no-new-privileges`, `user: 1000:1000` (the image's `node` user), `init: true`, `mem_limit` and `memswap_limit` 1536 MB, `pids_limit: 64`, `cpus: 0.75` (2026-10-19: was 2, which Docker refuses on the single-core test server; a share of one core also keeps the app responsive while ffmpeg runs). No `env_file`: its environment is only `MEDIA_SOCKET` and `MEDIA_WORK_DIR` (plus the image's defaults). No `files` volume, no database URL. Two volumes of its own: `media_socket` (shared with the app, holds only the socket) and `media_work` (inputs and outputs while a run lasts; on disk, because a tmpfs would charge a 2 GB upload to the memory limit).

The protocol (`infra/media/sandbox-server.ts` and `sandbox-client.ts`) is plain HTTP over the socket, with Node's own `http` module (no new dependency):
- `POST /speech-audio`, the input as the body → 200 with the `.m4a`.
- `POST /split?seconds=N` → 200 with the parts as frames: a 4-byte big-endian length, then the bytes.
- `GET /health` → 200 (the compose healthcheck).
- Errors: 422 with ffmpeg's message (not media, refused by the whitelist), 413 over the input limit, 411 without a length, 503 when three runs are already going, 400 or 404 for a bad request.

The sandbox runs the hardened `createFfmpeg` of ADR 0041 unchanged; each request gets its own directory, removed when it ends, and a run whose client went away is killed (an `AbortSignal` on `MediaTools`). The client (`createSandboxMedia`) implements the same `MediaTools`, so the meeting jobs did not change. It refuses an input over `MEETING_LIMITS.recordingBytes` (2 GB) before sending, an answer over 512 MB or 1000 parts, gives up after the sandbox's 2-hour kill timer plus 5 minutes, and turns every failure into a `MediaFailedError` with a clear reason (`media sandbox unavailable (ENOENT on /run/media/media.sock)`, `media sandbox: 503 busy`, …). The jobs retry a minute later, up to three attempts, as before.

Selection in `createDeps`: `FFMPEG_PATH=fake` → the fake (e2e); `MEDIA_SANDBOX_SOCKET` set → the sandbox; otherwise the local hardened ffmpeg (dev, tests, a machine without compose). Compose sets `MEDIA_SANDBOX_SOCKET=/run/media/media.sock` on the app, so production always uses the sandbox; without it in production the app logs a warning at start.

The app does not wait for `media` to be healthy (`depends_on` is not set): a broken sandbox stops meeting recordings only, never the whole site.

## Consequences
- A compromised ffmpeg sees no secrets, no database, no stored files except the one input, and has no network; it can only answer the request it was given, and the client caps what it accepts.
- The app image still carries ffmpeg (the sandbox uses it, and dev or a manual run can fall back to it). Image size is unchanged.
- The sandbox holds a copy of the app's code and `node_modules` but no configuration; that is accepted for one image instead of two.
- Inputs travel over the socket once more (a copy of up to 2 GB on the same disk), a few seconds next to a transcode of minutes.
- `media_work` has no quota; at most three runs of at most 2 GB each live there, and a restart clears leftovers.
- Tests: `sandbox.test.ts` runs the server and the client over a temp socket (transcode, framed split, 422, 413 in both, output cap, 503, sandbox down, timeout with the run killed, truncated frames, health) and, where ffmpeg is installed, the hardened ffmpeg behind the socket with an ffconcat file refused. Checked locally with the built image and the compose flags: health 200, no network (`ENETUNREACH`), the environment holds no secrets, a transcode and a split from a second container over the shared volume, ffconcat answered 422.
