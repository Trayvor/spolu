import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type {
  SourceMeeting as SourceMeetingDto,
  SourceMessage as SourceMessageDto,
  SourceTicket as SourceTicketDto,
} from '@spolu/shared';
import { chatMessageLocation } from '@/features/chat/links';

const EXCERPT_LENGTH = 140;

/**
 * "Created from a message": the chat message an AI-made task came from, in the group chat or in a
 * task's chat. The link is a router `<Link>`, so leaving with unsaved edits asks first.
 */
export function SourceMessage({
  groupId,
  message,
}: {
  groupId: string;
  message: SourceMessageDto;
}) {
  const { t } = useTranslation();
  const letters = Array.from(message.excerpt); // whole characters, never half an emoji
  const text =
    letters.length > EXCERPT_LENGTH
      ? `${letters.slice(0, EXCERPT_LENGTH).join('')}…`
      : message.excerpt;
  return (
    <section aria-label={t('tasks.panel.fromMessage')} className="rounded-lg bg-secondary p-4">
      <h3 className="text-button font-semibold">{t('tasks.panel.fromMessage')}</h3>
      <p className="mt-1 text-tiny font-semibold text-neutral">{message.authorName}</p>
      <p className="mt-1 break-words text-body">{text}</p>
      <Link
        {...chatMessageLocation(groupId, {
          messageId: message.id,
          channelId: message.channelId,
          taskId: message.taskId,
        })}
        className="mt-2 inline-block text-button font-semibold underline underline-offset-4 hover:text-neutral"
      >
        {t('tasks.panel.openMessage')}
      </Link>
    </section>
  );
}

/**
 * "Ticket: #123 subject" (Phase 21): the ticket a task was made from, one line linking to the
 * ticket page. The server sends it only to people who can read the ticket.
 */
export function SourceTicketLine({ ticket }: { ticket: SourceTicketDto }) {
  const { t } = useTranslation();
  return (
    <p className="flex min-w-0 items-baseline gap-1.5 text-button">
      <span className="shrink-0 font-semibold text-muted-foreground">
        {t('tasks.panel.fromTicket')}
      </span>
      <Link
        to="/tickets/$ticketId"
        params={{ ticketId: ticket.id }}
        className="min-w-0 truncate font-semibold underline underline-offset-4 hover:text-neutral"
      >
        #{ticket.number}
        {ticket.subject ? ` ${ticket.subject}` : ''}
      </Link>
    </p>
  );
}

/**
 * "Meeting: <title>": the meeting a task was made from, one line opening it in the group's
 * Knowledge tab. The server sends it only to people who can read the meeting.
 */
export function SourceMeetingLine({
  groupId,
  meeting,
}: {
  groupId: string;
  meeting: SourceMeetingDto;
}) {
  const { t } = useTranslation();
  return (
    <p className="flex min-w-0 items-baseline gap-1.5 text-button">
      <span className="shrink-0 font-semibold text-muted-foreground">
        {t('tasks.panel.fromMeeting')}
      </span>
      <Link
        to="/groups/$groupId/knowledge"
        params={{ groupId }}
        search={{ k: meeting.id }}
        className="min-w-0 truncate font-semibold underline underline-offset-4 hover:text-neutral"
      >
        {meeting.title}
      </Link>
    </p>
  );
}
