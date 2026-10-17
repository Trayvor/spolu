import { AiTextButton } from '@/features/chat/ai-tools/ai-text-button';
import type { AiTarget } from '@/features/chat/ai-tools/api';
import { VoiceButton } from '@/features/chat/voice-input/voice-button';

/** An AI answer as one entry per line: no list markers, no blank lines. */
export function toLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * The tools of `PlainTextField` (a lazy chunk): the microphone and the AI button. With `lines`
 * a dictation starts a new line and the AI's answer is cut back to one entry per line.
 */
export default function PlainTextTools({
  target,
  value,
  onChange,
  lines,
}: {
  target: AiTarget;
  value: string;
  onChange(next: string): void;
  lines: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <VoiceButton
        target={target}
        getText={() => (lines && value !== '' && !value.endsWith('\n') ? `${value}\n` : value)}
        setText={onChange}
      />
      <AiTextButton
        target={target}
        getText={() => value}
        setText={(text) => onChange(lines ? toLines(text) : text)}
      />
    </div>
  );
}
