import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MediaFailedError, type MediaTools } from './media.js';

/**
 * The media sandbox (ADR 0048): a tiny HTTP server on a Unix socket that runs `MediaTools`
 * (hardened ffmpeg, ADR 0041) inside the `media` container, which has no network, no secrets, no
 * database and no stored files. Each request gets its own directory under `workDir`, removed when
 * it ends. The protocol is described in `sandbox-client.ts`.
 */
export interface SandboxServerOptions {
  media: MediaTools;
  /** Where inputs and outputs live while a run lasts (a volume of the sandbox only). */
  workDir: string;
  /** Larger request bodies are refused with 413. */
  maxInputBytes: number;
  /** More runs at once are refused with 503 (the app retries a failed job a minute later). */
  maxRuns: number;
}

/** The longest a request body may take to arrive (2 GB over a local socket takes seconds). */
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
/** The longest split segment accepted (a day). */
const MAX_SEGMENT_SECONDS = 24 * 60 * 60;

export function createSandboxServer(options: SandboxServerOptions): Server {
  let running = 0;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://sandbox');
    if (req.method === 'GET' && url.pathname === '/health') return reply(res, 200, 'ok');
    const route = req.method === 'POST' ? url.pathname : '';
    if (route !== '/speech-audio' && route !== '/split') return reply(res, 404, 'not found');
    const seconds = Number(url.searchParams.get('seconds'));
    if (
      route === '/split' &&
      (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SEGMENT_SECONDS)
    ) {
      return reply(res, 400, 'bad seconds');
    }
    const length = Number(req.headers['content-length'] ?? Number.NaN);
    if (!Number.isInteger(length) || length < 0) return reply(res, 411, 'length required');
    if (length > options.maxInputBytes) return reply(res, 413, 'input too large');
    if (running >= options.maxRuns) return reply(res, 503, 'busy');

    running += 1;
    // The app gave up (timeout, restart): kill the run instead of finishing it for nobody.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    let dir: string | null = null;
    try {
      dir = await mkdtemp(join(options.workDir, 'run-'));
      const input = join(dir, 'input');
      await pipeline(req, capped(length), createWriteStream(input));
      if (route === '/speech-audio') {
        const output = join(dir, 'speech.m4a');
        await options.media.toSpeechAudio(input, output, abort.signal);
        const { size } = await stat(output);
        res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': size });
        await pipeline(createReadStream(output), res);
      } else {
        const partsDir = join(dir, 'parts');
        await mkdir(partsDir);
        const parts = await options.media.split(input, partsDir, seconds, abort.signal);
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        await pipeline(Readable.from(frames(parts)), res);
      }
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
      } else if (error instanceof MediaFailedError) {
        reply(res, 422, error.message);
      } else {
        console.warn(`media sandbox: ${route} failed: ${(error as Error).message}`);
        reply(res, 500, 'internal error');
      }
    } finally {
      running -= 1;
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => res.destroy());
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return server;
}

function reply(res: ServerResponse, status: number, text: string): void {
  if (res.destroyed) return;
  // An early refusal leaves the body unread: close the connection rather than drain it.
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
  res.end(text);
}

/** Fails once the body is longer than its Content-Length said. */
function capped(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > max) done(new Error('body longer than content-length'));
      else done(null, chunk);
    },
  });
}

/** Each part as a 4-byte big-endian length, then its bytes. */
async function* frames(parts: string[]): AsyncGenerator<Buffer> {
  for (const part of parts) {
    const { size } = await stat(part);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(size);
    yield header;
    for await (const chunk of createReadStream(part)) yield chunk as Buffer;
  }
}
