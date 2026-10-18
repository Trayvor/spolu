import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TicketDto } from '@spolu/shared';

/**
 * What the ticket page says about the ticket's eGrant project (Phase 33 part P3, spec §5.5), for
 * admins and the group's clients (a žiadateľ's DTO carries none of it): the raw project id of a
 * ticket without a client, "has not arrived yet" while it waits for its project, the project's
 * pending changes from eGrant with "Review" (the project sheet in Prehľad), and an archived
 * project. Nothing when none applies.
 */
export function TicketEgrantNotes({ ticket }: { ticket: TicketDto }) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`tickets.egrant.${key}`, options);
  const lines = [
    ticket.groupId === null && ticket.egrantProjectId !== null && (
      <p key="raw">{k('raw', { id: ticket.egrantProjectId })}</p>
    ),
    ticket.waitingForProject && ticket.egrantProjectId !== null && (
      <p key="waiting">{k('waiting', { id: ticket.egrantProjectId })}</p>
    ),
    ticket.egrantChanges && ticket.groupId !== null && (
      <p key="changes">
        {k('changes')}{' '}
        <Link
          to="/groups/$groupId/overview"
          params={{ groupId: ticket.groupId }}
          search={ticket.project ? { sheet: ticket.project.id } : {}}
          className="font-semibold underline underline-offset-2"
        >
          {k('review')}
        </Link>
      </p>
    ),
    ticket.projectArchived && <p key="archived">{k('archived')}</p>,
  ].filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div
      data-testid="ticket-egrant"
      className="flex flex-col gap-1 rounded-lg bg-secondary px-3 py-2 text-tiny"
    >
      {lines}
    </div>
  );
}

/**
 * Under the client select of the edit form, when the chosen client is another one: the project and
 * event stay behind, and eGrant's project id is matched again in the new client.
 */
export function MoveProjectWarning({ ticket, groupId }: { ticket: TicketDto; groupId: string }) {
  const { t } = useTranslation();
  if (groupId === '' || groupId === (ticket.groupId ?? '')) return null;
  if (ticket.project === null && ticket.egrantProjectId === null) return null;
  return (
    <p className="text-tiny text-muted-foreground">
      {ticket.egrantProjectId !== null
        ? t('tickets.egrant.moveRematch', { id: ticket.egrantProjectId })
        : t('tickets.egrant.moveClears')}
    </p>
  );
}
