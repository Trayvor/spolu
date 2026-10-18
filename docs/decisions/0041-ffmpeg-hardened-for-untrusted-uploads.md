# 0041 ffmpeg runs hardened for untrusted uploads: input whitelists and a minimal environment

Date: 2026-10-18
Status: accepted

## Context
Meeting recordings ([ADR 0023](0023-ffmpeg-static-build-for-meeting-audio.md)) are uploaded by anyone who may edit a meeting, and the upload check looks only at the declared Content-Type and the file name, both chosen by the client. ffmpeg then parses the bytes. The security review (finding M3) named two risks:
- ffmpeg probed the input with every demuxer it has. Playlist-style formats detected by content, such as an `ffconcat` file, make ffmpeg open other local files or URLs. A test confirmed it: an upload containing `ffconcat version 1.0` and `file 'other.wav'` was transcoded from `other.wav`. That is local file read, or SSRF to the internal Docker network through a URL.
- A crafted file that hits a demuxer memory-safety bug runs code as the Node user. The child inherited Node's whole environment, so `APP_SECRET`, `DATABASE_URL` and every API key were in its own env.

## Decision
Every ffmpeg run (`infra/media/media.ts`, the only place that spawns it; there is no ffprobe) gets:
- **Input options before `-i`:** `-protocol_whitelist file` (only local files, no `http`, `tcp`, `pipe` or `data`), `-format_whitelist` with only the audio and video containers the upload takes (`INPUT_FORMATS`: mov, matroska, webm, ogg, wav, mp3, aac, flac, caf, amr, asf, avi, mpeg, and since 2026-10-18 aiff and mpegts: the upload takes any `audio/*` or `video/*` type, so macOS `.aiff` memos and `.ts`/`.m2ts` recordings arrive too, review V7). concat/ffconcat, hls, dash, image2, tee, subfile and every other demuxer are refused, also for nested inputs a demuxer opens. ffmpeg checks the whitelist itself, after probing, so this needs no magic-byte sniffing of our own.
- **Limits:** `-nostdin`, `-threads 2` for the decoder and the encoder, `-max_alloc 256 MiB` (the largest single allocation; ffmpeg's default is about 2 GB), and the existing 2-hour `SIGKILL` timer.
- **Environment:** only `PATH` (`ffmpegEnv()`), never `process.env`.

**ffmpeg 8.1.2** (review H2 point 3): the image moves from `mwader/static-ffmpeg:7.1.1` to `8.1.2` (the newest 8.x release, June 2026), pinned by its multi-arch manifest digest `sha256:33f770f8…` like the other images ([ADR 0037](0037-supply-chain-policy.md)). 7.1.1 is from 2025, and later releases fix demuxer CVEs. Checked in that image: a transcode of an mp4 and a split with the hardened arguments succeed, and an ffconcat file is refused with "Format not on whitelist". The media test passes on ffmpeg 8.1.1 locally. 9.x is out too, but this change stays on 8.x, the smaller step from 7.1.

Not done here: a separate transcoding container with no network, a read-only root and `cap_drop: ALL` (review M3 point 3). It is the stronger isolation, but it changes the deployment and the job runner; it stays a follow-up. Done in [ADR 0048](0048-ffmpeg-in-a-media-sandbox-container.md).

## Consequences
- An upload in a container outside the list (for example a raw `.m3u8`) fails as "failed", like any file that is not media. Adding a format means adding its demuxer to `INPUT_FORMATS` and its extension to `MEDIA_EXTENSIONS` in `meeting-recording.ts`.
- A compromised ffmpeg still runs as the Node user and can read files that user can read (`/proc/<node pid>/environ` included); only the separate container closes that.
- The image size with ffmpeg 8.1.2 was not measured again (the [performance](../architecture/performance.md) figure is for 7.1.1).
- Tests: a stand-in binary records the arguments and the environment (no secrets, the whitelists before `-i`); where ffmpeg is installed, a crafted ffconcat upload is refused and no output is written.
