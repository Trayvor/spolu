import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VOICE_LIMITS } from '@spolu/shared';
import { Toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAiTools } from '../ai-tools/api';
import { iconButton } from '../format-toolbar';
import { CloseIcon } from '../icons';
import { appendTranscript, transcribe } from './api';
import { useRecorder } from './use-recorder';

export interface VoiceButtonProps {
  channelId: string;
  /** The draft as it is now (read when the transcript arrives). */
  getText(): string;
  /** Replaces the draft (Markdown); the transcript is appended, nothing is sent. */
  setText(text: string): void;
  className?: string;
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

type Notice = 'denied' | 'unsupported' | 'failed' | 'limited' | 'atLimit';

/**
 * Voice input (Phase 28): the microphone records until the person taps Stop (no cut-off on
 * silence, only the 5-minute limit), shows a timer and a Cancel, then the server transcribes the
 * audio and the text is added to the draft for review. Hidden when the server has no
 * transcription. Self-contained: it only needs the channel and the draft callbacks.
 */
export function VoiceButton({ channelId, getText, setText, className }: VoiceButtonProps) {
  const { t } = useTranslation();
  const tools = useAiTools(channelId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function send(audio: Blob | null, atLimit = false) {
    if (!audio || audio.size === 0) return;
    setBusy(true);
    try {
      const text = await transcribe(channelId, audio);
      setText(appendTranscript(getText(), text));
      if (atLimit) setNotice('atLimit');
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 429 ? 'limited' : 'failed');
    }
    setBusy(false);
  }

  const recorder = useRecorder({ onLimit: (audio) => void send(audio, true) });
  const recording = recorder.state === 'recording';
  const shown = notice;

  if (!tools?.voice) return null;

  const toast = shown && <Toast onClose={() => setNotice(null)}>{t(`chat.voice.${shown}`)}</Toast>;

  if (recording) {
    return (
      <div className={cn('flex shrink-0 items-center gap-1', className)}>
        <span className="flex items-center gap-1.5 px-1 text-micro tabular-nums text-error-ink">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-error-ink motion-safe:animate-pulse"
          />
          <span role="timer" aria-label={t('chat.voice.recording')}>
            {clock(recorder.seconds)} / {clock(VOICE_LIMITS.maxSeconds)}
          </span>
        </span>
        <button
          type="button"
          aria-label={t('chat.voice.cancel')}
          title={t('chat.voice.cancel')}
          onClick={recorder.cancel}
          className={iconButton}
        >
          <CloseIcon />
        </button>
        <button
          type="button"
          aria-label={t('chat.voice.stop')}
          title={t('chat.voice.stop')}
          onClick={() => void recorder.stop().then((audio) => send(audio))}
          className={cn(iconButton, 'text-error-ink hover:text-error-ink')}
        >
          <StopIcon />
        </button>
      </div>
    );
  }

  const working = busy || recorder.state === 'starting';
  return (
    <>
      <button
        type="button"
        aria-label={busy ? t('chat.voice.transcribing') : t('chat.voice.start')}
        title={busy ? t('chat.voice.transcribing') : t('chat.voice.start')}
        aria-busy={busy || undefined}
        disabled={working}
        onClick={() => {
          setNotice(null);
          void recorder.start().then((problem) => problem && setNotice(problem));
        }}
        className={cn(iconButton, 'shrink-0', className)}
      >
        {busy ? (
          <span
            className="size-4 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
            aria-hidden="true"
          />
        ) : (
          <MicIcon />
        )}
      </button>
      {toast}
    </>
  );
}

function MicIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
