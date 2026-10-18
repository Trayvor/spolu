import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createFfmpeg } from './infra/media/media.js';
import { SANDBOX_MAX_INPUT_BYTES } from './infra/media/sandbox-client.js';
import { createSandboxServer } from './infra/media/sandbox-server.js';

/**
 * Entry point of the `media` container (ADR 0048): `node server/media-sandbox.js`. It reads no
 * app settings; only where to listen and work, and the ffmpeg binary.
 */
const socketPath = process.env.MEDIA_SOCKET ?? '/run/media/media.sock';
const workDir = process.env.MEDIA_WORK_DIR ?? '/work';
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
/** One transcode and two meeting AI splits at once (the app's job concurrency, `deps.ts`). */
const MAX_RUNS = 3;

// A socket and run directories left by a killed container.
await rm(socketPath, { force: true });
await mkdir(workDir, { recursive: true });
for (const name of await readdir(workDir)) {
  await rm(join(workDir, name), { recursive: true, force: true });
}

const server = createSandboxServer({
  media: createFfmpeg(ffmpeg),
  workDir,
  maxInputBytes: SANDBOX_MAX_INPUT_BYTES,
  maxRuns: MAX_RUNS,
});
server.listen(socketPath, () => console.log(`media sandbox listening on ${socketPath}`));

// PID 1 in the container: exit on a stop signal (running ffmpeg children go with the container).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
