import { lazy, Suspense, type Ref } from 'react';
import { Label } from '@/components/ui/label';
import type { AiTarget } from '@/features/chat/ai-tools/api';
import { withNamespaces } from '@/i18n/namespaces';
import { cn } from '@/lib/utils';

// The AI button and the microphone (and the `chat` texts they show) are a lazy chunk: a form
// gains only this shell, and the textarea itself is there at once.
const PlainTextTools = lazy(withNamespaces(['chat'], () => import('./plain-text-tools')));

export interface PlainTextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange(next: string): void;
  /** Where the AI and voice calls go: the group the text belongs to, or the admin scope. */
  target: AiTarget;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  describedBy?: string;
  /** One entry per line (meeting decisions): the AI's list markers are stripped and a dictation starts a new line. */
  lines?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** The AI button and the microphone (default on; the server still decides what shows). */
  aiTools?: boolean;
}

const AREA =
  'min-h-24 w-full resize-y rounded-md border-2 border-input bg-card px-[18px] py-[13px] text-button font-medium text-foreground transition-colors duration-(--duration-fast) placeholder:text-muted-foreground focus:border-foreground aria-invalid:border-destructive';

/**
 * A plain-text multi-line field with the AI button and the microphone (the editor's tools for
 * text whose stored format is plain: one entry per line, notes to Claude, a ticket body without
 * a group). The value in and out is the textarea's own text, never Markdown.
 */
export function PlainTextField({
  id,
  label,
  value,
  onChange,
  target,
  rows = 4,
  maxLength,
  placeholder,
  describedBy,
  lines = false,
  textareaRef,
  aiTools = true,
}: PlainTextFieldProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {aiTools && (
          <Suspense fallback={null}>
            <PlainTextTools target={target} value={value} onChange={onChange} lines={lines} />
          </Suspense>
        )}
      </div>
      <textarea
        ref={textareaRef}
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className={cn(AREA)}
      />
    </div>
  );
}
