import { useId, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CLAUDE_NEW_CHAT_URL,
  CLAUDE_NOTES_MAX,
  CLAUDE_URL_MAX,
  ClaudePromptSchema,
  claudeChatUrl,
  type ClaudePrompt,
} from '@spolu/shared';
import { Icon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { PanelHeader } from '@/components/ui/panel-header';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { ADMIN_AI_TARGET } from '@/features/chat/ai-tools/api';
import { PlainTextField } from '@/features/editor/plain-text-field';
import { fileUrl } from '@/features/files/urls';
import { useNamespaces } from '@/i18n/namespaces';
import { apiSend } from '@/lib/api';
import { cn } from '@/lib/utils';

export type ClaudeSource = { kind: 'ticket' | 'task'; id: string };

/** A four-point spark: "work on this with AI". Not the Claude logo. */
const SparkIcon = () => (
  <Icon>
    <path d="M12 3c.5 4.5 2 6.5 6.5 7-4.5.5-6 2.5-6.5 7-.5-4.5-2-6.5-6.5-7 4.5-.5 6-2.5 6.5-7Z" />
    <path d="M19 15.5c.2 1.6.8 2.3 2.5 2.5-1.7.2-2.3.9-2.5 2.5-.2-1.6-.8-2.3-2.5-2.5 1.7-.2 2.3-.9 2.5-2.5Z" />
  </Icon>
);

/**
 * "Vyriešiť s Claude" (Phase 29), admins only (the server answers anyone else 403). The button
 * opens a dialog with optional notes for Claude; "Generate" asks the server for the prompt (the
 * item's context, its whole recent chat, the notes and the eGrant MCP instructions). Then the
 * dialog offers "Open in Claude" (`claude.ai/new?q=…`, or, above `CLAUDE_URL_MAX`, the prompt on
 * the clipboard and an empty chat), "Copy prompt", and, when the item has files, the reminder to
 * attach them in Claude by hand with a download link each (claude.ai takes no files by URL).
 * `compact` keeps only the icon below 641 px (the task panel header).
 */
export default function SolveWithClaude({
  source,
  compact = false,
}: {
  source: ClaudeSource;
  compact?: boolean;
}) {
  useNamespaces(['openInClaude', 'forms']);
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(compact && 'max-[640px]:size-11 max-[640px]:border-0 max-[640px]:px-0')}
      >
        <SparkIcon />
        <span className={cn(compact && 'max-[640px]:sr-only')}>{t('openInClaude.button')}</span>
      </Button>
      {open && <SolveDialog source={source} onClose={() => setOpen(false)} />}
    </>
  );
}

type Status = 'opened' | 'pasteInClaude' | 'copied' | 'copyFailed' | null;

function SolveDialog({ source, onClose }: { source: ClaudeSource; onClose: () => void }) {
  const { t } = useTranslation();
  const uid = useId();
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const generate = useMutation({
    mutationFn: (): Promise<ClaudePrompt> =>
      apiSend(
        'POST',
        `/${source.kind}s/${encodeURIComponent(source.id)}/claude-prompt`,
        { notes },
        ClaudePromptSchema,
      ),
    onSuccess: () => setStatus(null),
  });
  const result = generate.data;

  // Both run straight from a click: browsers allow a new tab and a clipboard write only then.
  // The copy starts before the new tab takes the focus (Chrome copies only for a focused page).
  function copy(text: string, done: Status) {
    navigator.clipboard.writeText(text).then(
      () => setStatus(done),
      () => setStatus('copyFailed'),
    );
  }
  function openInClaude(prompt: string) {
    const url = claudeChatUrl(prompt);
    if (url.length <= CLAUDE_URL_MAX) {
      window.open(url, '_blank', 'noopener');
      setStatus('opened');
      return;
    }
    copy(prompt, 'pasteInClaude');
    window.open(CLAUDE_NEW_CHAT_URL, '_blank', 'noopener');
  }

  return (
    <SheetDialog onEscape={onClose} initialFocus={notesRef} testId="solve-with-claude">
      <PanelHeader onClose={onClose} compactBelow={641}>
        <span />
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 min-[641px]:px-6 min-[641px]:py-5">
        <SheetDialogTitle className="text-medium font-semibold">
          {t('openInClaude.title')}
        </SheetDialogTitle>
        <p className="text-button text-muted-foreground">{t('openInClaude.intro')}</p>

        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            generate.mutate();
          }}
        >
          <PlainTextField
            id={`${uid}-notes`}
            target={ADMIN_AI_TARGET}
            label={t('openInClaude.notesLabel')}
            textareaRef={notesRef}
            rows={4}
            value={notes}
            maxLength={CLAUDE_NOTES_MAX}
            placeholder={t('openInClaude.notesPlaceholder')}
            describedBy={`${uid}-notes-hint`}
            onChange={setNotes}
          />
          <p id={`${uid}-notes-hint`} className="text-tiny text-muted-foreground">
            {t('openInClaude.notesHint')}
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button
              type="submit"
              variant={result ? 'outline' : 'default'}
              disabled={generate.isPending}
            >
              {t(result ? 'openInClaude.regenerate' : 'openInClaude.generate')}
            </Button>
            {!result && (
              <Button type="button" variant="outline" onClick={onClose}>
                {t('openInClaude.cancel')}
              </Button>
            )}
          </div>
          {generate.isPending && (
            <p role="status" className="text-tiny text-muted-foreground">
              {t('openInClaude.generating')}
            </p>
          )}
          {generate.isError && (
            <p role="alert" className="text-tiny text-error-ink">
              {t('openInClaude.loadFailed')}
            </p>
          )}
        </form>

        {result && !generate.isPending && (
          <section
            aria-labelledby={`${uid}-ready`}
            className="flex flex-col gap-4 border-t-2 border-border pt-5"
          >
            <h3 id={`${uid}-ready`} className="text-body font-semibold">
              {t('openInClaude.ready')}
            </h3>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => openInClaude(result.prompt)}>
                <SparkIcon />
                {t('openInClaude.open')}
              </Button>
              <Button variant="outline" onClick={() => copy(result.prompt, 'copied')}>
                {t('openInClaude.copy')}
              </Button>
            </div>
            <p
              role="status"
              className={cn(
                'text-button empty:hidden',
                status === 'copyFailed' ? 'text-error-ink' : 'text-foreground',
              )}
            >
              {status && t(`openInClaude.status.${status}`)}
            </p>
            {result.files.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg bg-muted p-4">
                <p className="text-button font-semibold">{t('openInClaude.filesReminder')}</p>
                <ul role="list" className="flex flex-col gap-1">
                  {result.files.map((f) => (
                    <li key={f.id} className="min-w-0">
                      <a
                        href={fileUrl(f.id)}
                        download={f.name}
                        className="inline-flex min-h-11 items-center text-button break-all underline underline-offset-4 hover:text-neutral min-[641px]:min-h-0"
                      >
                        {f.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <details className="rounded-lg border-2 border-border">
              <summary className="cursor-pointer px-4 py-3 text-button font-semibold">
                {t('openInClaude.preview')}
              </summary>
              <pre className="max-h-80 overflow-auto border-t-2 border-border px-4 py-3 text-tiny whitespace-pre-wrap break-words">
                {result.prompt}
              </pre>
            </details>
          </section>
        )}
      </div>
    </SheetDialog>
  );
}
