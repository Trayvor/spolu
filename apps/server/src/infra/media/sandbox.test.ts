import { spawnSync } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakeMedia, createFfmpeg, MediaFailedError, type MediaTools } from './media.js';
import { createSandboxMedia } from './sandbox-client.js';
import { createSandboxServer } from './sandbox-server.js';

const binary = process.env.FFMPEG_PATH ?? 'ffmpeg';
const hasFfmpeg = spawnSync(binary, ['-version']).status === 0;

describe('media sandbox', () => {
  let dir: string;
  let workDir: string;
  let n = 0;
  const servers: Server[] = [];

  beforeAll(async () => {
    // A short base path: a Unix socket path is limited to about 100 bytes.
    dir = await mkdtemp(join(tmpdir(), 'spolu-sbx-'));
    workDir = join(dir, 'work');
    await mkdir(workDir);
  });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function listen(server: Server): Promise<string> {
    const socketPath = join(dir, `s${(n += 1)}.sock`);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    return socketPath;
  }

  async function sandbox(
    media: MediaTools,
    extra: { maxInputBytes?: number; maxRuns?: number } = {},
  ) {
    return listen(
      createSandboxServer({
        media,
        workDir,
        maxInputBytes: extra.maxInputBytes ?? 1024 * 1024,
        maxRuns: extra.maxRuns ?? 3,
      }),
    );
  }

  async function file(name: string, content: string | Buffer): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
  }

  it('transcodes through the sandbox and leaves no run directory behind', async () => {
    const client = createSandboxMedia({ socketPath: await sandbox(createFakeMedia()) });
    const input = await file('in.bin', 'some audio bytes');
    const output = join(dir, 'out.m4a');
    await client.toSpeechAudio(input, output);
    expect(await readFile(output, 'utf8')).toBe('some audio bytes');
    await expect.poll(() => readdir(workDir)).toEqual([]);
  });

  it('splits into framed parts, written in order (an empty part included)', async () => {
    const parts = ['first part', '', 'x'.repeat(200_000)];
    const media: MediaTools = {
      toSpeechAudio: () => Promise.reject(new Error('unused')),
      async split(_input, partsDir, seconds) {
        expect(seconds).toBe(60);
        const paths = [];
        for (const [i, content] of parts.entries()) {
          const path = join(partsDir, `p${i}`);
          await writeFile(path, content);
          paths.push(path);
        }
        return paths;
      },
    };
    const client = createSandboxMedia({ socketPath: await sandbox(media) });
    const out = join(dir, 'parts');
    await mkdir(out);
    const paths = await client.split(await file('a.m4a', 'audio'), out, 60);
    expect(paths.map((p) => p.slice(out.length + 1))).toEqual([
      'part-0000.m4a',
      'part-0001.m4a',
      'part-0002.m4a',
    ]);
    expect(await Promise.all(paths.map((p) => readFile(p, 'utf8')))).toEqual(parts);
  });

  it('an input ffmpeg refuses is a MediaFailedError with its reason', async () => {
    const client = createSandboxMedia({ socketPath: await sandbox(createFakeMedia()) });
    const bad = await file('bad.bin', 'NOT-MEDIA');
    await expect(client.toSpeechAudio(bad, join(dir, 'x.m4a'))).rejects.toThrow(
      /media sandbox: 422 not media/,
    );
    await expect.poll(() => readdir(workDir)).toEqual([]);
  });

  it('refuses an input over the limit, in the app and in the sandbox', async () => {
    const socketPath = await sandbox(createFakeMedia(), { maxInputBytes: 10 });
    const big = await file('big.bin', 'x'.repeat(11));
    await expect(
      createSandboxMedia({ socketPath, maxInputBytes: 10 }).toSpeechAudio(big, join(dir, 'o')),
    ).rejects.toThrow(/over 10/);
    await expect(
      createSandboxMedia({ socketPath }).toSpeechAudio(big, join(dir, 'o')),
    ).rejects.toThrow(/413 input too large/);
  });

  it('refuses an output over the limit', async () => {
    const client = createSandboxMedia({
      socketPath: await sandbox(createFakeMedia()),
      maxOutputBytes: 5,
    });
    await expect(
      client.toSpeechAudio(await file('six.bin', 'sixsix'), join(dir, 'o6')),
    ).rejects.toThrow(MediaFailedError);
    await mkdir(join(dir, 'p6'));
    await expect(
      client.split(await file('six2.bin', 'sixsix'), join(dir, 'p6'), 60),
    ).rejects.toThrow(/output over 5 bytes/);
  });

  it('a busy sandbox answers 503', async () => {
    let release: (() => void) | null = null;
    const media: MediaTools = {
      toSpeechAudio: () => new Promise((resolve) => (release = resolve)),
      split: () => Promise.resolve([]),
    };
    const socketPath = await sandbox(media, { maxRuns: 1 });
    const client = createSandboxMedia({ socketPath });
    const input = await file('busy.bin', 'audio');
    const first = client.toSpeechAudio(input, join(dir, 'b1')).catch((e: Error) => e);
    // Wait until the first run holds the slot.
    await expect.poll(() => release).not.toBeNull();
    await expect(client.toSpeechAudio(input, join(dir, 'b2'))).rejects.toThrow(/503 busy/);
    release!();
    // The fake run wrote no output, so the first call fails, but it got its answer.
    expect(await first).toBeInstanceOf(MediaFailedError);
  });

  it('a sandbox that is down is a clear MediaFailedError', async () => {
    const client = createSandboxMedia({ socketPath: join(dir, 'missing.sock') });
    await expect(client.toSpeechAudio(await file('d.bin', 'a'), join(dir, 'd'))).rejects.toThrow(
      /media sandbox unavailable \(ENOENT/,
    );
  });

  it('gives up after the timeout, and the sandbox kills the run', async () => {
    let aborted = false;
    const media: MediaTools = {
      toSpeechAudio: (_i, _o, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new MediaFailedError('killed'));
          }),
        ),
      split: () => Promise.resolve([]),
    };
    const client = createSandboxMedia({ socketPath: await sandbox(media), timeoutMs: 200 });
    await expect(client.toSpeechAudio(await file('t.bin', 'a'), join(dir, 't'))).rejects.toThrow(
      /no answer within 0.2 s/,
    );
    await expect.poll(() => aborted).toBe(true);
    await expect.poll(async () => (await readdir(workDir)).length).toBe(0);
  });

  it('answers the health check; unknown routes and bad seconds are refused', async () => {
    const socketPath = await sandbox(createFakeMedia());
    const get = (method: string, path: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request({ socketPath, path, method }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
    expect(await get('GET', '/health')).toBe(200);
    expect(await get('GET', '/speech-audio')).toBe(404);
    expect(await get('POST', '/split?seconds=0')).toBe(400);
    expect(await get('POST', '/split?seconds=abc')).toBe(400);
  });

  it('truncated split frames fail', async () => {
    // A stand-in sandbox that announces 10 bytes and sends 3.
    const socketPath = await listen(
      createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          res.writeHead(200);
          const header = Buffer.alloc(4);
          header.writeUInt32BE(10);
          res.end(Buffer.concat([header, Buffer.from('abc')]));
        });
      }),
    );
    await mkdir(join(dir, 'tr'));
    await expect(
      createSandboxMedia({ socketPath }).split(await file('tr.bin', 'a'), join(dir, 'tr'), 60),
    ).rejects.toThrow(/truncated parts/);
  });

  it.skipIf(!hasFfmpeg)('runs the hardened ffmpeg behind the socket', async () => {
    const audio = join(dir, 'tone.wav');
    const made = spawnSync(binary, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=5',
      audio,
    ]);
    expect(made.status).toBe(0);
    const client = createSandboxMedia({
      socketPath: await sandbox(createFfmpeg(binary), { maxInputBytes: 10_000_000 }),
    });
    const speech = join(dir, 'tone.m4a');
    await client.toSpeechAudio(audio, speech);
    const out = join(dir, 'tone-parts');
    await mkdir(out);
    const parts = await client.split(speech, out, 2);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    // An ffconcat playlist is refused by the format whitelist, through the sandbox too.
    const playlist = await file('list.txt', "ffconcat version 1.0\nfile 'tone.wav'\n");
    await expect(client.toSpeechAudio(playlist, join(dir, 'p.m4a'))).rejects.toThrow(/422/);
  });
});
