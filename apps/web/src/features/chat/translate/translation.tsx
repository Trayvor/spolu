import { createContext, useCallback, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IncomingTranslationSchema, type IncomingTranslation } from '@spolu/shared';
import { ApiError, apiSend } from '@/lib/api';

/**
 * Reading a received text in one's own language (2026-10-19, ADR 0061): a message someone else
 * wrote, or a ticket description, translated by the server into the language the reader sees
 * (the request's Accept-Language). Offered in every client group, never in the admin group's
 * chat (`translateIncoming` of the channel's AI tools; before 2026-10-21 only off `.sk`).
 */

/** What can be translated: a chat message or a ticket's description. */
export type TranslateSubject = { kind: 'message' | 'ticket'; id: string };

export function translateIncoming(subject: TranslateSubject): Promise<IncomingTranslation> {
  const base = subject.kind === 'message' ? 'messages' : 'tickets';
  return apiSend(
    'POST',
    `/${base}/${encodeURIComponent(subject.id)}/translate`,
    undefined,
    IncomingTranslationSchema,
  );
}

/** Whether the messages of this chat offer "Translate" (set by the conversation). */
export const TranslateIncomingContext = createContext(false);
export const useTranslateIncoming = () => useContext(TranslateIncomingContext);

export type TranslationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed'; rateLimited: boolean }
  | { status: 'done'; translation: IncomingTranslation; showOriginal: boolean };

/**
 * One text's translation, kept while the row is shown. A changed text (an edit) forgets it: the
 * reader translates the new text again (the server stores one translation per text).
 */
export function useIncomingTranslation(subject: TranslateSubject, text: string) {
  const [state, setState] = useState<TranslationState>({ status: 'idle' });
  const [forText, setForText] = useState(text);
  if (forText !== text) {
    setForText(text);
    setState({ status: 'idle' });
  }
  const { kind, id } = subject;
  const start = useCallback(() => {
    setState({ status: 'loading' });
    translateIncoming({ kind, id }).then(
      (translation) => setState({ status: 'done', translation, showOriginal: false }),
      (error: unknown) =>
        setState({
          status: 'failed',
          rateLimited: error instanceof ApiError && error.status === 429,
        }),
    );
  }, [kind, id]);
  const toggle = useCallback(
    () => setState((s) => (s.status === 'done' ? { ...s, showOriginal: !s.showOriginal } : s)),
    [],
  );
  /** The text to show: the translation unless the reader asked for the original. */
  const shown =
    state.status === 'done' && !state.showOriginal && !state.translation.unchanged
      ? state.translation.text
      : text;
  return { state, start, toggle, shown };
}

const languageNames = new Map<string, Intl.DisplayNames>();
/** A language code's name in the reader's language ("čeština"); the code if unknown. */
function languageName(code: string, uiLanguage: string): string {
  let names = languageNames.get(uiLanguage);
  if (!names) {
    names = new Intl.DisplayNames([uiLanguage], { type: 'language' });
    languageNames.set(uiLanguage, names);
  }
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The 16 px outline glyph of Translate: a letter and a character with a swap between them. */
export const TranslateIcon = () => (
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
    <path d="m5 8 6 6" />
    <path d="m4 14 6-6 2-3" />
    <path d="M2 5h12" />
    <path d="M7 2h1" />
    <path d="m22 22-5-10-5 10" />
    <path d="M14 18h6" />
  </svg>
);

const textButton =
  'relative font-semibold text-brand-purple-ink underline-offset-2 hover:underline after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[""]';

/**
 * The line under a translated text: where it was translated from and the switch to the original
 * (or back); while loading, "Translating…"; after a failure, why, and Try again. Nothing while
 * idle. Announced politely to screen readers.
 */
export function TranslationNote({
  state,
  onRetry,
  onToggle,
  offer = false,
}: {
  state: TranslationState;
  onRetry: () => void;
  onToggle: () => void;
  /** While idle, show "Translate" itself (a ticket description has no action menu). */
  offer?: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (state.status === 'idle') {
    return offer ? (
      <p className="mt-0.5 text-micro">
        <button type="button" className={textButton} onClick={onRetry}>
          {t('chat.actions.translate')}
        </button>
      </p>
    ) : null;
  }
  let content;
  if (state.status === 'loading') {
    content = <span className="text-muted-foreground">{t('chat.translation.loading')}</span>;
  } else if (state.status === 'failed') {
    content = (
      <>
        <span className="text-error-ink">
          {state.rateLimited ? t('chat.translation.rateLimited') : t('chat.translation.failed')}
        </span>
        <button type="button" className={textButton} onClick={onRetry}>
          {t('chat.translation.retry')}
        </button>
      </>
    );
  } else {
    const { translation, showOriginal } = state;
    const source = translation.sourceLanguage
      ? languageName(translation.sourceLanguage, i18n.language)
      : null;
    if (translation.unchanged) {
      content = (
        <span className="text-muted-foreground">
          {t('chat.translation.unchanged', {
            language: languageName(translation.targetLanguage, i18n.language),
          })}
        </span>
      );
    } else {
      content = (
        <>
          <span className="text-muted-foreground">
            {showOriginal
              ? t('chat.translation.original')
              : source
                ? t('chat.translation.from', { language: source })
                : t('chat.translation.translated')}
          </span>
          <button type="button" className={textButton} onClick={onToggle}>
            {showOriginal
              ? t('chat.translation.showTranslation')
              : t('chat.translation.showOriginal')}
          </button>
        </>
      );
    }
  }
  return (
    <p
      role="status"
      data-translation-note=""
      className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-micro"
    >
      {content}
    </p>
  );
}
