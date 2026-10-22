import type { KnowledgeOrigin } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { SmallTaskIcon, SmallTicketIcon } from './icons';

/**
 * The link to a ticket or task file's source (2026-10-22): the ticket page, or the task panel on
 * the group's board.
 */
export const originLocation = (groupId: string, origin: KnowledgeOrigin) =>
  origin.kind === 'ticket'
    ? { to: '/tickets/$ticketId' as const, params: { ticketId: origin.id } }
    : {
        to: '/groups/$groupId/tasks/$taskId' as const,
        params: { groupId, taskId: origin.id },
      };

/** Where a ticket or task file came from: "Ticket #12" or "Task: Budget". */
export function OriginLabel({ origin }: { origin: KnowledgeOrigin }) {
  const { t } = useTranslation();
  const ticket = origin.kind === 'ticket';
  return (
    <span className="flex min-w-0 items-center gap-1">
      {ticket ? <SmallTicketIcon /> : <SmallTaskIcon />}
      <span className="truncate">
        {ticket
          ? t('knowledge.origin.ticket', { number: origin.number ?? '' })
          : t('knowledge.origin.task', { title: origin.title ?? '' })}
      </span>
    </span>
  );
}
