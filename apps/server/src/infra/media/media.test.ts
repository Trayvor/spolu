import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeMedia, createFfmpeg, INPUT_FORMATS, MediaFailedError } from './media.js';

const binary = process.env.FFMPEG_PATH ?? 'ffmpeg';
const hasFfmpeg = spawnSync(binary, ['-version']).status === 0;

describe('media', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spolu-media-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('the fake copies bytes and refuses a file that is not media', async () => {
    const media = createFakeMedia();
    await writeFile(join(dir, 'in.bin'), 'audio');
    await media.toSpeechAudio(join(dir, 'in.bin'), join(dir, 'out.m4a'));
    expect((await stat(join(dir, 'out.m4a'))).size).toBe(5);
    await writeFile(join(dir, 'bad.bin'), 'NOT-MEDIA');
    await expect(media.toSpeechAudio(join(dir, 'bad.bin'), join(dir, 'x.m4a'))).rejects.toThrow(
      MediaFailedError,
    );
  });

  it('the format whitelist opens AIFF (macOS) and MPEG-TS (.ts, .m2ts), which uploads take', () => {
    expect(INPUT_FORMATS).toContain('aiff');
    expect(INPUT_FORMATS).toContain('mpegts');
  });

  it('a missing ffmpeg fails with MediaFailedError', async () => {
    const media = createFfmpeg(join(dir, 'no-such-ffmpeg'));
    await expect(media.toSpeechAudio('a', 'b')).rejects.toThrow(MediaFailedError);
  });

  it('runs ffmpeg with input whitelists, capped threads and an environment without secrets', async () => {
    // A stand-in binary that records its arguments and environment.
    const fake = join(dir, 'record-ffmpeg.sh');
    await writeFile(
      fake,
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${dir}/args.txt'\n/usr/bin/env > '${dir}/env.txt'\n`,
    );
    await chmod(fake, 0o755);
    const saved = { APP_SECRET: process.env.APP_SECRET, DATABASE_URL: process.env.DATABASE_URL };
    process.env.APP_SECRET = 'secret-for-the-env-test';
    process.env.DATABASE_URL = 'postgres://secret@db/spolu';
    try {
      const media = createFfmpeg(fake);
      for (const call of [
        () => media.toSpeechAudio(join(dir, 'in.bin'), join(dir, 'o.m4a')),
        () => media.split(join(dir, 'in.bin'), dir, 60),
      ]) {
        await call();
        const env = await readFile(join(dir, 'env.txt'), 'utf8');
        expect(env).not.toContain('secret');
        expect(env).not.toMatch(/^(APP_SECRET|DATABASE_URL)=/m);
        expect(env).toMatch(/^PATH=/m);
        const args = (await readFile(join(dir, 'args.txt'), 'utf8')).trim().split('\n');
        const input = args.indexOf('-i');
        const before = args.slice(0, input);
        expect(before).toContain('-nostdin');
        expect(before[before.indexOf('-protocol_whitelist') + 1]).toBe('file');
        const formats = before[before.indexOf('-format_whitelist') + 1]?.split(',');
        expect(formats).toContain('mov');
        expect(formats).not.toContain('concat');
        expect(formats).not.toContain('hls');
        expect(before[before.indexOf('-threads') + 1]).toBe('2');
      }
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  // A playlist detected by its content would make ffmpeg read another local file (review M3).
  it.skipIf(!hasFfmpeg)('refuses an ffconcat playlist and reads no other file', async () => {
    const other = join(dir, 'other.wav');
    const made = spawnSync(binary, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      other,
    ]);
    expect(made.status).toBe(0);
    // A relative path passes the concat demuxer's `safe` check; the upload has no extension.
    const playlist = join(dir, 'upload');
    await writeFile(playlist, "ffconcat version 1.0\nfile 'other.wav'\n");
    const output = join(dir, 'playlist.m4a');
    await expect(createFfmpeg(binary).toSpeechAudio(playlist, output)).rejects.toThrow(
      MediaFailedError,
    );
    await expect(stat(output)).rejects.toThrow();
  });

  // Runs where ffmpeg is installed (the Docker image, CI runners, a dev machine with it).
  it.skipIf(!hasFfmpeg)('transcodes a video to compact audio and splits it', async () => {
    const video = join(dir, 'clip.mp4');
    const made = spawnSync(binary, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=5',
      '-f',
      'lavfi',
      '-i',
      'color=size=64x64:duration=5',
      '-shortest',
      video,
    ]);
    expect(made.status).toBe(0);
    const media = createFfmpeg(binary);
    const audio = join(dir, 'speech.m4a');
    await media.toSpeechAudio(video, audio);
    // 5 s at 32 kbps is about 20 kB; the video was dropped.
    expect((await stat(audio)).size).toBeLessThan(60_000);
    const parts = join(dir, 'parts');
    await mkdir(parts);
    const list = await media.split(audio, parts, 2);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]).toMatch(/part-0000\.m4a$/);
    await expect(media.toSpeechAudio(join(dir, 'bad.bin'), join(dir, 'y.m4a'))).rejects.toThrow(
      MediaFailedError,
    );
  });
});
