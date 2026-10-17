import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeMedia, createFfmpeg, MediaFailedError } from './media.js';

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

  it('a missing ffmpeg fails with MediaFailedError', async () => {
    const media = createFfmpeg(join(dir, 'no-such-ffmpeg'));
    await expect(media.toSpeechAudio('a', 'b')).rejects.toThrow(MediaFailedError);
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
