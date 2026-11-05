import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TicketDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { formatCreated } from '@/features/tasks/dates';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ticketQuery, useConfirmationAction, type ConfirmationAction } from './api';

/** The id the `?confirm=1` link scrolls to. */
export const CONFIRMATION_CARD_ID = 'ticket-confirmation';

/**
 * The bar above the chat (design 5.5, 2026-11-04), next to the rating card so a phone shows it
 * without opening the details. What it offers comes from `ticket.confirmation`: an admin's "Solved
 * on our side", the author's "Solved", and on a marked ticket the author's card with both answers
 * and the automatic end. The flags cannot tell an admin from another client of the group on a
 * marked ticket (both may do nothing), so `admin` decides who reads the waiting line; it shows
 * text, never an action. Nothing on a resolved ticket: the rating card stays alone there. The
 * pressed button goes with its state, so a success moves the focus here, or to the page heading
 * when nothing is left, unless something else holds it (the time dialog).
 */
export function TicketConfirmation({ ticket, admin }: { ticket: TicketDto; admin: boolean }) {
  const { t, i18n } = useTranslation();
  const { resolvesAt, canMarkDone, canConfirm, canDecline } = ticket.confirmation;
  const action = useConfirmationAction(ticket.id);
  const queryClient = useQueryClient();
  const [error, setError] = useState<'generic' | 'changed' | null>(null);
  // `disabled` follows a render later; a second click of a double click must find this set.
  const sending = useRef(false);
  const section = useRef<HTMLElement>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const focusedFor = useRef<string | null>(null);
  const titleId = useId();

  // `landed` is the saved ticket's `updatedAt`: the focus moves once that ticket has drawn.
  useEffect(() => {
    if (landed === null || landed === focusedFor.current || ticket.updatedAt < landed) return;
    focusedFor.current = landed;
    if (document.activeElement && document.activeElement !== document.body) return;
    const target = section.current ?? document.querySelector<HTMLElement>('#main h1');
    if (target && !target.hasAttribute('tabindex')) target.tabIndex = -1;
    target?.focus();
  }, [landed, ticket.updatedAt]);

  const send = (name: ConfirmationAction) => {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    setLanded(null);
    action.mutate(name, {
      onSuccess: (saved) => setLanded(saved.updatedAt),
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409) {
          setError('changed');
          void queryClient.invalidateQueries({ queryKey: ticketQuery(ticket.id).queryKey });
        } else {
          setError('generic');
        }
      },
      onSettled: () => {
        sending.current = false;
      },
    });
  };
  const date = resolvesAt ? formatCreated(resolvesAt, i18n.language) : '';
  const pending = action.isPending;

  let body: ReactNode = null;
  if (canDecline) {
    body = (
      <>
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-body font-semibold">
            {t('tickets.confirmation.title')}
          </h2>
          <p className="text-button text-muted-foreground">
            {t('tickets.confirmation.hint', { date })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={() => send('confirm')}>
            {t('tickets.confirmation.yes')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => send('decline')}
          >
            {t('tickets.confirmation.no')}
          </Button>
        </div>
      </>
    );
  } else if (canMarkDone) {
    body = (
      <div>
        <Button type="button" disabled={pending} onClick={() => send('admin-done')}>
          {t('tickets.confirmation.markDone')}
        </Button>
      </div>
    );
  } else if (canConfirm) {
    body = (
      <div>
        <Button type="button" disabled={pending} onClick={() => send('confirm')}>
          {t('tickets.confirmation.solved')}
        </Button>
      </div>
    );
  } else if (admin && resolvesAt) {
    body = (
      <p role="status" className="text-button text-muted-foreground">
        {t('tickets.confirmation.waiting', { date })}
      </p>
    );
  }

  // The refused action's message outlives the state it was pressed in.
  if (!body && !error) return null;
  return (
    <section
      ref={section}
      tabIndex={-1}
      id={canDecline ? CONFIRMATION_CARD_ID : undefined}
      aria-labelledby={canDecline ? titleId : undefined}
      className={cn('flex flex-col gap-4 rounded-xl bg-card', canDecline ? 'p-5' : 'px-5 py-4')}
    >
      {body}
      {error && (
        <p role="alert" className="text-tiny font-semibold text-destructive">
          {t(error === 'changed' ? 'tickets.confirmation.changed' : 'errors.generic')}
        </p>
      )}
    </section>
  );
}
