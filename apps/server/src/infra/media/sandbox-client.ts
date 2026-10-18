import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, type FileHandle } from 'node:fs/promises';
import { request, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MEETING_LIMITS } from '@spolu/shared';
import { MAX_RUN_MS, MediaFailedError, type MediaTools } from './media.js';

/**
 * The app's side of the media sandbox (ADR 0048): the same `MediaTools`, but ffmpeg runs in the
 * `media` container (`sandbox-server.ts`), reached over a Unix socket on a volume the two share.
 * The input goes up as the request body, the output comes back as the response body; nothing
 * else is shared, so the sandbox sees no secrets, no database and no stored files.
 *
 * Protocol: `POST /speech-audio` → the `.m4a`; `POST /split?seconds=N` → the parts as frames, each
 * a 4-byte big-endian length followed by that many bytes; `GET /health` → 200. An error is a
 * non-200 status with a short text body (422: ffmpeg refused the input, 413: too large, 503: busy).
 */

/** The largest input passed (a recording upload is at most this, see `MEETING_LIMITS`). */
export const SANDBOX_MAX_INPUT_BYTES = MEETING_LIMITS.recordingBytes;
/** The most the app accepts back: speech audio is 32 kbps, so this is far beyond any recording. */
export const SANDBOX_MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
/** The most split parts accepted (20-minute parts: over 300 hours). */
const MAX_PARTS = 1000;
/** The sandbox kills ffmpeg after MAX_RUN_MS; the app gives up a little later. */
const TIMEOUT_MS = MAX_RUN_MS + 5 * 60 * 1000;
const MAX_ERROR_TEXT = 500;

export interface SandboxClientOptions {
  /** The sandbox's socket (`MEDIA_SANDBOX_SOCKET`). */
  socketPath: string;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

/** `MediaTools` over the media sandbox. Every failure is a `MediaFailedError` with a clear reason. */
export function createSandboxMedia(options: SandboxClientOptions): MediaTools {
  const maxInput = options.maxInputBytes ?? SANDBOX_MAX_INPUT_BYTES;
  const maxOutput = options.maxOutputBytes ?? SANDBOX_MAX_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  /** Sends `input` to `path` and hands the 200 response to `read`; maps every error. */
  async function call<T>(
    path: string,
    input: string,
    signal: AbortSignal | undefined,
    read: (response: IncomingMessage) => Promise<T>,
  ): Promise<T> {
    const { size } = await stat(input);
    if (size > maxInput) {
      throw new MediaFailedError(`media sandbox: input of ${size} bytes is over ${maxInput}`);
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    try {
      const response = await send(options.socketPath, path, input, size, combined);
      if (response.statusCode !== 200) {
        const text = await errorText(response);
        throw new MediaFailedError(`media sandbox: ${response.statusCode} ${text}`);
      }
      return await read(response);
    } catch (error) {
      if (error instanceof MediaFailedError) throw error;
      if (timeout.aborted) {
        throw new MediaFailedError(`media sandbox: no answer within ${timeoutMs / 1000} s`);
      }
      if (signal?.aborted) throw new MediaFailedError('media sandbox: aborted');
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        throw new MediaFailedError(`media sandbox unavailable (${code} on ${options.socketPath})`);
      }
      throw new MediaFailedError(`media sandbox: ${code ?? (error as Error).message}`);
    }
  }

  return {
    toSpeechAudio: (input, output, signal) =>
      call('/speech-audio', input, signal, async (response) => {
        await pipeline(response, capped(maxOutput), createWriteStream(output));
      }),
    split: (input, dir, seconds, signal) =>
      call(`/split?seconds=${seconds}`, input, signal, (response) =>
        readFrames(response, dir, maxOutput),
      ),
  };
}

function send(
  socketPath: string,
  path: string,
  input: string,
  size: number,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'content-length': size },
        signal,
      },
      resolve,
    );
    req.on('error', reject);
    const body = createReadStream(input);
    body.on('error', (error) => req.destroy(error));
    body.pipe(req);
  });
}

async function errorText(response: IncomingMessage): Promise<string> {
  let text = '';
  for await (const chunk of response) {
    text += (chunk as Buffer).toString('utf8');
    if (text.length > MAX_ERROR_TEXT) {
      response.destroy();
      break;
    }
  }
  return text.slice(0, MAX_ERROR_TEXT).trim();
}

/** Passes bytes through and fails once more than `max` went by. */
function capped(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > max) done(new MediaFailedError(`media sandbox: output over ${max} bytes`));
      else done(null, chunk);
    },
  });
}

/** Writes the framed parts of a split response to `dir/part-NNNN.m4a`; their paths in order. */
async function readFrames(response: IncomingMessage, dir: string, max: number): Promise<string[]> {
  const paths: string[] = [];
  let header = Buffer.alloc(0);
  let file: FileHandle | null = null;
  let remaining = 0;
  let total = 0;
  const startPart = async () => {
    if (paths.length >= MAX_PARTS) throw new MediaFailedError('media sandbox: too many parts');
    const path = join(dir, `part-${String(paths.length).padStart(4, '0')}.m4a`);
    paths.push(path);
    file = await open(path, 'w');
  };
  try {
    for await (const chunk of response) {
      let buf = chunk as Buffer;
      total += buf.length;
      if (total > max) throw new MediaFailedError(`media sandbox: output over ${max} bytes`);
      while (buf.length > 0) {
        if (!file) {
          header = Buffer.concat([header, buf]);
          if (header.length < 4) break;
          remaining = header.readUInt32BE(0);
          buf = header.subarray(4);
          header = Buffer.alloc(0);
          await startPart();
        }
        // A part of zero bytes ends right after its header.
        const handle: FileHandle = file!;
        const take = buf.subarray(0, remaining);
        if (take.length > 0) await handle.write(take);
        remaining -= take.length;
        buf = buf.subarray(take.length);
        if (remaining === 0) {
          await handle.close();
          file = null;
        }
      }
    }
    if (file || header.length > 0) throw new MediaFailedError('media sandbox: truncated parts');
    return paths;
  } finally {
    if (file) await (file as FileHandle).close().catch(() => undefined);
  }
}
