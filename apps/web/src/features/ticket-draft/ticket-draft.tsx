import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TICKET_DRAFT_INSTRUCTIONS_MAX,
  type MessageKnowledge,
  type TicketDraft,
} from '@spolu/shared';
import { Icon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { PanelHeader } from '@/components/ui/panel-header';
import { Label } from '@/components/ui/label';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import type { ComposerDraft } from '@/features/chat/conversation';
import { iconButton } from '@/features/chat/format-toolbar';
import { MessageBody } from '@/features/chat/format/render';
import { KnowledgeCardList } from '@/features/chat/knowledge-cards';
import { useNamespaces } from '@/i18n/namespaces';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { postTicketDraft } from './api';

export type TicketDraftButtonProps = {
  ticketId: string;
  number: number;
  /** The ticket's client, for the subtitle. */
  client: string;
  draft: ComposerDraft;
};

/** A speech bubble with a spark: "let the AI suggest a reply". */
const DraftIcon = () => (
  <Icon>
    <path d="M20 12.5V17a2 2 0 0 1-2 2H9l-5 3v-5a2 2 0 0 1-1-1.7V7a2 2 0 0 1 2-2h7" />
    <path d="M18 2c.3 2.2 1.1 3.1 3.3 3.4-2.2.3-3 1.2-3.3 3.4-.3-2.2-1.1-3.1-3.3-3.4 2.2-.3 3-1.2 3.3-3.4Z" />
  </Icon>
);

// The composer's other buttons have a 44 px tap area around their 32 px.
const HIT = "before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-['']";

/**
 * "Navrhnúť odpoveď" (2026-10-19), the composer button of a ticket chat for admins: a dialog
 * with optional instructions asks the server for an AI draft built from the ticket, its chat,
 * the client's shareable knowledge and similar resolved tickets. It shows the draft and its
 * sources; "Insert into message" replaces the composer's text (one undo step). Nothing is sent
 * or stored: the admin edits and sends the message as any other.
 */
export default function TicketDraftButton(props: TicketDraftButtonProps) {
  useNamespaces(['ticketDraft', 'forms']);
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={t('ticketDraft.button')}
        title={t('ticketDraft.button')}
        onClick={() => setOpen(true)}
        className={cn(iconButton, 'relative shrink-0', HIT)}
      >
        <DraftIcon />
      </button>
      {open && <DraftDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

type Failure = 'unavailable' | 'rateLimited' | 'notFound';

function failureOf(error: unknown): Failure {
  if (error instanceof ApiError && error.status === 429) return 'rateLimited';
  if (error instanceof ApiError && error.status === 404) return 'notFound';
  return 'unavailable';
}

function DraftDialog({
  ticketId,
  number,
  client,
  draft,
  onClose,
}: TicketDraftButtonProps & { onClose: () => void }) {
  const { t } = useTranslation();
  const uid = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TicketDraft | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const request = useRef<AbortController | null>(null);

  // Closing the dialog aborts a draft still on its way.
  useEffect(() => () => request.current?.abort(), []);

  async function generate() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailure(null);
    try {
      const answer = await postTicketDraft(ticketId, instructions, controller.signal);
      if (controller.signal.aborted) return;
      setResult(answer);
    } catch (error) {
      if (controller.signal.aborted) return;
      setFailure(failureOf(error));
    }
    setBusy(false);
  }

  function insert(reply: string) {
    draft.setText(reply);
    onClose();
    // After the dialog has given the focus back to its opener.
    setTimeout(() => draft.focus(), 0);
  }

  const knowledge: MessageKnowledge[] = (result?.sources ?? []).flatMap((s) =>
    s.kind === 'knowledge'
      ? [
          {
            id: s.id,
            available: true as const,
            type: s.type,
            title: s.title,
            folderPath: [],
            ...(s.fromAdminGroup ? { source: 'admin_group' as const } : {}),
          },
        ]
      : [],
  );
  const tickets = (result?.sources ?? []).flatMap((s) => (s.kind === 'ticket' ? [s] : []));
  const replacing = draft.getText().trim() !== '';

  return (
    <SheetDialog onEscape={onClose} initialFocus={field} testId="ticket-draft">
      <PanelHeader onClose={onClose} compactBelow={641}>
        <span />
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 min-[641px]:px-6 min-[641px]:py-5">
        <div className="flex flex-col gap-1">
          <SheetDialogTitle className="text-medium font-semibold">
            {t('ticketDraft.title')}
          </SheetDialogTitle>
          <p className="text-button text-muted-foreground">
            {t('ticketDraft.subtitle', { number, client })}
          </p>
        </div>

        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <Label htmlFor={`${uid}-instructions`}>{t('ticketDraft.instructions.label')}</Label>
          <textarea
            ref={field}
            id={`${uid}-instructions`}
            rows={3}
            value={instructions}
            maxLength={TICKET_DRAFT_INSTRUCTIONS_MAX}
            placeholder={t('ticketDraft.instructions.placeholder')}
            onChange={(e) => setInstructions(e.target.value)}
            className="min-h-20 w-full resize-y rounded-md border-2 border-input bg-card px-[18px] py-[13px] text-button font-medium text-foreground placeholder:text-muted-foreground focus:border-foreground"
          />
          {failure && !result && <FailureNote failure={failure} />}
          {!result && (
            <div className="flex flex-wrap gap-3 pt-1">
              <Button type="submit" disabled={busy} aria-busy={busy}>
                {busy && <Spinner />}
                {t(busy ? 'ticketDraft.generating' : 'ticketDraft.generate')}
              </Button>
            </div>
          )}
        </form>

        {result && (
          <section aria-busy={busy} className="flex flex-col gap-4 border-t-2 border-border pt-5">
            <div
              data-testid="ticket-draft-reply"
              className="max-h-[50vh] overflow-y-auto rounded-lg bg-muted px-4 py-3 text-body"
            >
              <MessageBody body={result.reply} nameOf={() => undefined} />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-button font-semibold">{t('ticketDraft.sources.title')}</h3>
              {result.sources.length === 0 ? (
                <p className="text-button text-muted-foreground">{t('ticketDraft.sources.none')}</p>
              ) : (
                <>
                  <KnowledgeCardList items={knowledge} groupId="" via={null} />
                  {tickets.length > 0 && (
                    <ul role="list" className="flex flex-col gap-1">
                      {tickets.map((s) => (
                        <li key={s.id}>
                          <a
                            href={`/tickets/${encodeURIComponent(s.id)}`}
                            target="_blank"
                            rel="noopener"
                            className="inline-flex min-h-11 items-center text-button underline underline-offset-4 hover:text-neutral min-[641px]:min-h-0"
                          >
                            #{s.number}
                            {s.subject ? ` ${s.subject}` : ''}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <p className="text-tiny text-muted-foreground">{t('ticketDraft.note')}</p>
          </section>
        )}

        {failure && result && <FailureNote failure={failure} />}

        {result && (
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => insert(result.reply)} disabled={busy}>
              {t(replacing ? 'ticketDraft.replace' : 'ticketDraft.insert')}
            </Button>
            <Button variant="outline" onClick={() => void generate()} disabled={busy}>
              {busy && <Spinner />}
              {t(busy ? 'ticketDraft.generating' : 'ticketDraft.again')}
            </Button>
          </div>
        )}
      </div>
    </SheetDialog>
  );
}

function FailureNote({ failure }: { failure: Failure }) {
  const { t } = useTranslation();
  return (
    <p role="alert" className="text-button text-error-ink">
      {t(`ticketDraft.errors.${failure}`)}
    </p>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
    />
  );
}
