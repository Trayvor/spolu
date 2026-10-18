import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ErrorCodes,
  TICKET_RATING_LIMITS,
  type TicketDto,
  type TicketRatingBody,
  type TicketRatingValue,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { formatCreated } from '@/features/tasks/dates';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ticketQuery, useRateTicket } from './api';
import { ThumbDown, ThumbUp } from './icons';

/** The id the `?rate=1` link scrolls to. */
export const RATING_CARD_ID = 'ticket-rating';
/** The counter shows from this many characters on. */
const COUNTER_FROM = 900;

const ICONS: Record<TicketRatingValue, () => ReactNode> = { up: ThumbUp, down: ThumbDown };

/**
 * The initiator's rating of a resolved ticket (2026-10-19): two toggle buttons that save at
 * once, then an optional comment for the eGrant team; changeable while `rating.canRate` (14 days
 * after resolving), read-only after. Nothing for anyone who cannot rate and has no rating. The
 * comment is plain text (React text nodes), never Markdown.
 */
export function TicketRating({ ticket }: { ticket: TicketDto }) {
  const { t, i18n } = useTranslation();
  const { mine, canRate, editableUntil } = ticket.rating;
  const rate = useRateTicket(ticket.id);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<'saveFailed' | 'closed' | null>(null);
  const titleId = useId();
  const fieldId = useId();
  if (!canRate && !mine) return null;

  const save = (body: TicketRatingBody, after?: () => void) => {
    setError(null);
    rate.mutate(body, {
      onSuccess: after,
      onError: (e) => {
        if (e instanceof ApiError && e.code === ErrorCodes.ratingClosed) {
          setError('closed');
          setEditing(false);
          void queryClient.invalidateQueries({ queryKey: ticketQuery(ticket.id).queryKey });
        } else {
          setError('saveFailed');
        }
      },
    });
  };
  const openComment = (comment: string | null) => {
    setDraft(comment ?? '');
    setEditing(true);
  };
  const choose = (value: TicketRatingValue) => {
    // Value only: a click never erases the stored comment.
    if (value === mine?.value) return;
    const first = mine === null;
    save({ value }, first ? () => openComment(null) : undefined);
  };
  const close = () => {
    setEditing(false);
    setError(null);
  };
  const send = () => {
    if (!mine) return;
    save({ value: mine.value, comment: draft }, close);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  const valueText = (value: TicketRatingValue) => t(`tickets.rating.${value}`);
  const errorLine = error && (
    <p role="alert" className="text-tiny font-semibold text-destructive">
      {t(error === 'closed' ? 'tickets.rating.closed' : 'tickets.rating.saveFailed')}
    </p>
  );
  const comment = mine?.comment ? (
    <p className="text-button whitespace-pre-line break-words text-muted-foreground">
      {mine.comment}
    </p>
  ) : null;

  if (!canRate && mine) {
    return (
      <section
        id={RATING_CARD_ID}
        aria-labelledby={titleId}
        className="flex flex-col gap-2 rounded-xl bg-card px-5 py-4"
      >
        <p id={titleId} className="flex items-center gap-2 text-button text-muted-foreground">
          {ICONS[mine.value]()}
          {t('tickets.rating.yours', { value: valueText(mine.value) })}
        </p>
        {comment}
        {errorLine}
      </section>
    );
  }

  const unchanged = draft.trim() === (mine?.comment ?? '');
  return (
    <section
      id={RATING_CARD_ID}
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-xl bg-card p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-body font-semibold">
          {mine ? t('tickets.rating.thanks') : t('tickets.rating.title')}
        </h2>
        {!mine && <p className="text-button text-muted-foreground">{t('tickets.rating.intro')}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {(['up', 'down'] as const).map((value) => {
          const pressed = mine?.value === value;
          return (
            <Button
              key={value}
              type="button"
              variant="outline"
              aria-pressed={pressed}
              disabled={rate.isPending}
              onClick={() => choose(value)}
              className={cn(pressed && 'bg-primary text-primary-foreground hover:bg-ink-hover')}
            >
              {ICONS[value]()}
              {valueText(value)}
            </Button>
          );
        })}
      </div>
      {editing && mine ? (
        <div className="flex flex-col gap-2.5" onKeyDown={onKeyDown}>
          <label htmlFor={fieldId} className="text-tiny font-semibold">
            {t('tickets.rating.commentLabel')}
          </label>
          <textarea
            id={fieldId}
            value={draft}
            rows={3}
            maxLength={TICKET_RATING_LIMITS.comment}
            aria-describedby={`${fieldId}-hint`}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-24 w-full rounded-md border-2 border-input bg-card px-[18px] py-[13px] text-button text-foreground focus:border-foreground"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={`${fieldId}-hint`} className="text-micro text-muted-foreground">
              {t('tickets.rating.commentHint')}
            </p>
            {draft.length >= COUNTER_FROM && (
              <span className="text-micro text-muted-foreground tabular-nums">
                {draft.length}/{TICKET_RATING_LIMITS.comment}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={unchanged || rate.isPending} onClick={send}>
              {t('tickets.rating.send')}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              {t('tickets.rating.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        mine && (
          <div className="flex flex-col gap-2">
            {comment}
            <p className="text-tiny text-muted-foreground">
              {editableUntil &&
                t('tickets.rating.editableUntil', {
                  date: formatCreated(editableUntil, i18n.language),
                })}{' '}
              <button
                type="button"
                onClick={() => openComment(mine.comment)}
                className="font-semibold text-foreground underline underline-offset-4 hover:text-neutral"
              >
                {t('tickets.rating.edit')}
              </button>
            </p>
          </div>
        )
      )}
      {errorLine}
    </section>
  );
}
