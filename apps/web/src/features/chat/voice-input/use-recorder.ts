import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_LIMITS } from '@spolu/shared';

export type RecorderState = 'idle' | 'starting' | 'recording';
export type RecorderError = 'denied' | 'unsupported';

// Opus first (Chrome, Firefox, Edge); Safari records AAC in MP4.
const TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];
// Speech needs little: 5 minutes stay near 1.2 MB.
const BITS_PER_SECOND = 32_000;

const pickType = () =>
  TYPES.find((type) => MediaRecorder.isTypeSupported?.(type) ?? false) ?? undefined;

const recordingSupported = () =>
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder === 'function' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function';

/**
 * One microphone recording at a time. The person stops it (`stop` resolves the audio); there is
 * no cut-off on silence, only the length limit, which stops it like `stop` and hands the audio to
 * `onLimit`. `cancel` throws it away. The microphone is released as soon as recording ends.
 */
export function useRecorder(options: { onLimit(audio: Blob): void }) {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const finish = useRef<((audio: Blob | null) => void) | null>(null);
  const onLimit = useRef(options.onLimit);
  useEffect(() => {
    onLimit.current = options.onLimit;
  });

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
    setState('idle');
    setSeconds(0);
  }, []);

  /** Ends the recording: the audio (stop) or null (cancel). */
  const end = useCallback(
    (keep: boolean): Promise<Blob | null> =>
      new Promise((resolve) => {
        const active = recorder.current;
        if (!active || active.state === 'inactive') {
          release();
          resolve(null);
          return;
        }
        finish.current = (audio) => resolve(keep ? audio : null);
        active.stop();
      }),
    [release],
  );

  /** Starts recording; resolves with why it could not (or null once it records). */
  const start = useCallback(async (): Promise<RecorderError | null> => {
    if (recorder.current) return null;
    if (!recordingSupported()) return 'unsupported';
    setState('starting');
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState('idle');
      return 'denied';
    }
    const mimeType = pickType();
    const next = new MediaRecorder(media, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: BITS_PER_SECOND,
    });
    const chunks: Blob[] = [];
    next.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    next.onstop = () => {
      const audio = new Blob(chunks, { type: next.mimeType || mimeType || 'audio/webm' });
      const done = finish.current;
      finish.current = null;
      release();
      if (done) done(audio);
      else onLimit.current(audio);
    };
    stream.current = media;
    recorder.current = next;
    const startedAt = Date.now();
    next.start(1000);
    setState('recording');
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(Math.min(elapsed, VOICE_LIMITS.maxSeconds));
      // The length limit: stop as if the person had, `onstop` hands the audio to onLimit.
      if (elapsed >= VOICE_LIMITS.maxSeconds && next.state === 'recording') next.stop();
    }, 250);
    return null;
  }, [release]);

  // Leaving the chat mid-recording drops it and frees the microphone.
  useEffect(
    () => () => {
      finish.current = () => {};
      if (recorder.current?.state === 'recording') recorder.current.stop();
      else release();
    },
    [release],
  );

  return {
    state,
    seconds,
    start,
    stop: () => end(true),
    cancel: () => void end(false),
  };
}
