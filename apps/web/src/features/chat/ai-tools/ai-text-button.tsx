import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiTextBody } from '@spolu/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { iconButton } from '../format-toolbar';
import { rewriteText, useAiTools } from './api';

export interface AiTextButtonProps {
  channelId: string;
  /** The draft as it is now (Markdown). */
  getText(): string;
  /** Replaces the draft with the AI's version (or back, on Undo). Nothing is sent. */
  setText(text: string): void;
  className?: string;
}

type Choice = Omit<AiTextBody, 'text'>;
type Notice = { kind: 'done'; before: string; after: string } | { kind: 'failed' | 'limited' };

/** The language's own name in the UI language ("čeština" in Slovak, "Czech" in English). */
function languageLabel(code: string, uiLanguage: string): string {
  try {
    return new Intl.DisplayNames([uiLanguage], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The AI text tools (Phase 28), a button next to Send like Telegram's: Fix mistakes, Make it
 * formal and, off `.sk` instances, Translate to English and to the client's language. The answer
 * replaces the draft for review, with Undo; nothing is sent. Hidden unless the server offers the
 * tools to this reader. Self-contained: it only needs the channel and the draft callbacks.
 */
export function AiTextButton({ channelId, getText, setText, className }: AiTextButtonProps) {
  const { t, i18n } = useTranslation();
  const tools = useAiTools(channelId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (!tools?.text) return null;

  async function run(choice: Choice) {
    const before = getText();
    if (before.trim() === '') return;
    setBusy(true);
    setNotice(null);
    try {
      const after = await rewriteText(channelId, { ...choice, text: before } as AiTextBody);
      setText(after);
      setNotice({ kind: 'done', before, after });
    } catch (error) {
      setNotice({
        kind: error instanceof ApiError && error.status === 429 ? 'limited' : 'failed',
      });
    }
    setBusy(false);
  }

  function undo() {
    if (notice?.kind !== 'done') return;
    setText(notice.before);
    setNotice(null);
  }

  const translate = tools.translate;
  const empty = getText().trim() === '';
  const label = busy ? t('chat.ai.working') : t('chat.ai.button');
  // Undo stays offered while the draft is still the AI's version.
  const canUndo = notice?.kind === 'done' && getText() === notice.after;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={label}
            aria-busy={busy || undefined}
            disabled={busy}
            className={cn(iconButton, 'shrink-0', className)}
          >
            {busy ? (
              <span
                aria-hidden="true"
                className="size-4 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
              />
            ) : (
              <SparkleIcon />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          <DropdownMenuItem disabled={empty} onSelect={() => void run({ action: 'fix' })}>
            {t('chat.ai.fix')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={empty} onSelect={() => void run({ action: 'formal' })}>
            {t('chat.ai.formal')}
          </DropdownMenuItem>
          {translate && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={empty}
                onSelect={() => void run({ action: 'translate', target: 'en' })}
              >
                {t('chat.ai.translateTo', { language: languageLabel('en', i18n.language) })}
              </DropdownMenuItem>
              {translate.clientLanguage && (
                <DropdownMenuItem
                  disabled={empty}
                  onSelect={() => void run({ action: 'translate', target: 'client' })}
                >
                  {t('chat.ai.translateTo', {
                    language: languageLabel(translate.clientLanguage, i18n.language),
                  })}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canUndo && (
        <button
          type="button"
          onClick={undo}
          className="shrink-0 rounded-md px-2 py-1 text-micro font-semibold underline max-[640px]:min-h-11"
        >
          {t('chat.ai.undo')}
        </button>
      )}
      {notice && notice.kind !== 'done' && (
        <Toast onClose={() => setNotice(null)}>{t(`chat.ai.${notice.kind}`)}</Toast>
      )}
    </>
  );
}

function SparkleIcon() {
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
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}
