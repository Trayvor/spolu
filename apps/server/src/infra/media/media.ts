import { spawn } from 'node:child_process';
import { copyFile, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Audio work for meeting recordings (Phase 30, ADR 0023): ffmpeg as a child process, never
 * through a shell, hardened for untrusted uploads (ADR 0041): only local files and audio/video
 * demuxers as input, capped threads and allocations, a 2-hour kill timer and an environment
 * with nothing but PATH. A fake for tests and machines without ffmpeg.
 */
export interface MediaTools {
  /**
   * Transcodes any audio or video file to compact speech audio: AAC-LC mono, 16 kHz, 32 kbps in
   * an `.m4a` (`output`), video dropped.
   */
  toSpeechAudio(input: string, output: string): Promise<void>;
  /** Splits an `.m4a` into segments of `seconds` in `dir` (no re-encode); their paths in order. */
  split(input: string, dir: string, seconds: number): Promise<string[]>;
}

export class MediaFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaFailedError';
  }
}

/** A transcode may take this long (a 2 GB video of several hours) before it is killed. */
const MAX_RUN_MS = 2 * 60 * 60 * 1000;

/**
 * The child's whole environment (review M3): only PATH, so a compromised ffmpeg (a crafted
 * upload hitting a demuxer bug) finds no APP_SECRET, DATABASE_URL or API keys in its own env.
 */
export function ffmpegEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' };
}

function run(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'], env: ffmpegEnv() });
    // Only the end of stderr is kept, for the exit message (it holds paths and codec names).
    let tail = '';
    child.stderr.on('data', (chunk: Buffer) => {
      tail = (tail + chunk.toString('utf8')).slice(-500);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), MAX_RUN_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new MediaFailedError(`ffmpeg could not start (${error.name})`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new MediaFailedError(`ffmpeg exited with ${signal ?? code}: ${tail.trim()}`));
    });
  });
}

/**
 * Demuxers ffmpeg may open an input with (review M3, ADR 0041): the containers of the media
 * extensions the upload takes (`MEDIA_EXTENSIONS` in `meeting-recording.ts`), plus Apple's CAF.
 * The upload also takes any `audio/*` or `video/*` type, so AIFF (macOS voice memos, `aiff`) and
 * MPEG transport streams (`.ts`, `.m2ts` recorders, `mpegts`) are here too (review V7).
 * Playlist-style formats that ffmpeg detects by content and that open other files or URLs
 * (concat/ffconcat, hls, dash, image2 sequences, tee, subfile, ...) are refused. ffmpeg matches
 * each against a demuxer's name list, so `mov` covers mp4/m4a/3gp and `matroska` covers webm.
 * Keep it in step with `MEDIA_EXTENSIONS`.
 */
export const INPUT_FORMATS = [
  'mov',
  'matroska',
  'webm',
  'ogg',
  'wav',
  'mp3',
  'aac',
  'flac',
  'caf',
  'amr',
  'asf',
  'avi',
  'mpeg',
  'aiff',
  'mpegts',
] as const;

/** Threads per decoder and encoder: speech audio needs little, and a bad input cannot fan out. */
const THREADS = '2';
/** The largest single allocation ffmpeg may make (its default is about 2 GB). */
const MAX_ALLOC_BYTES = String(256 * 1024 * 1024);

/** ffmpeg at `binary` (`FFMPEG_PATH`, default `ffmpeg` on the PATH). */
export function createFfmpeg(binary: string): MediaTools {
  const base = [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-max_alloc',
    MAX_ALLOC_BYTES,
  ];
  // Input options, before `-i`: only local files, only the formats above.
  const inputOf = (path: string) => [
    '-protocol_whitelist',
    'file',
    '-format_whitelist',
    INPUT_FORMATS.join(','),
    '-threads',
    THREADS,
    '-i',
    path,
  ];
  return {
    toSpeechAudio: (input, output) =>
      run(binary, [
        ...base,
        ...inputOf(input),
        '-threads',
        THREADS,
        '-vn',
        '-sn',
        '-dn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'aac',
        '-b:a',
        '32k',
        '-movflags',
        '+faststart',
        '-f',
        'ipod',
        output,
      ]),
    async split(input, dir, seconds) {
      await run(binary, [
        ...base,
        ...inputOf(input),
        '-vn',
        '-c',
        'copy',
        '-f',
        'segment',
        '-segment_time',
        String(seconds),
        '-segment_format',
        'ipod',
        '-reset_timestamps',
        '1',
        join(dir, 'part-%04d.m4a'),
      ]);
      return (await readdir(dir))
        .filter((name) => /^part-\d{4}\.m4a$/.test(name))
        .sort()
        .map((name) => join(dir, name));
    },
  };
}

/**
 * Tests and e2e without ffmpeg: "transcoding" copies the bytes, splitting returns one part. A
 * file whose bytes start with `NOT-MEDIA` fails, like ffmpeg on a file that is not media.
 */
export function createFakeMedia(): MediaTools {
  const check = async (input: string) => {
    const handle = await open(input, 'r');
    try {
      const head = Buffer.alloc(9);
      await handle.read(head, 0, 9, 0);
      if (head.toString('latin1') === 'NOT-MEDIA') throw new MediaFailedError('not media');
    } finally {
      await handle.close();
    }
  };
  return {
    async toSpeechAudio(input, output) {
      await check(input);
      await copyFile(input, output);
    },
    async split(input, dir) {
      const part = join(dir, 'part-0000.m4a');
      await copyFile(input, part);
      return [part];
    },
  };
}
