import { useId, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { GroupPerson, TicketDto } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { PeopleSelect } from '@/components/people-select';
import { candidatesQuery, useAssignee } from './api';

/** The most riešitelia a ticket has (the server checks the same). */
const MAX_ASSIGNEES = 10;
const everyone = () => true;

/**
 * The ticket's riešitelia (assignees). Admins and the group's clients (`ticket.canAssign`) pick
 * them with the task form's people field: every admin and the group's clients are offered, and a
 * chosen person is a removable chip; each change saves at once. A new riešiteľ is notified and
 * follows the ticket. Everyone else sees the avatars and names only.
 */
export function TicketAssignees({ ticket }: { ticket: TicketDto }) {
  const { t } = useTranslation();
  const inputId = useId();
  const candidates = useQuery({ ...candidatesQuery(ticket.id), enabled: ticket.canAssign }).data;
  const change = useAssignee(ticket.id);
  // The picker takes group people; a candidate is one, admins marked as such.
  const people = useMemo<GroupPerson[] | undefined>(
    () => candidates?.map((c) => ({ ...c, isManager: false })),
    [candidates],
  );
  const value = ticket.assignees.map((p) => p.id);

  const onChange = (next: string[]) => {
    if (change.isPending) return;
    const added = next.find((id) => !value.includes(id));
    const removed = value.find((id) => !next.includes(id));
    if (added) change.mutate({ userId: added, add: true });
    else if (removed) change.mutate({ userId: removed, add: false });
  };

  return (
    <section aria-labelledby="ticket-assignees" className="flex flex-col gap-3">
      <h2 id="ticket-assignees" className="text-button font-semibold">
        <label htmlFor={people ? inputId : undefined}>
          {t('tickets.assignees.title', { count: ticket.assignees.length })}
        </label>
      </h2>
      {/* While the candidates load, the riešitelia show as for a reader. */}
      {people ? (
        <PeopleSelect
          people={people}
          value={value}
          onChange={onChange}
          knownPeople={ticket.assignees}
          inputId={inputId}
          max={MAX_ASSIGNEES}
          label={t('tickets.assignees.suggestions')}
          pickable={everyone}
        />
      ) : ticket.assignees.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {ticket.assignees.map((p) => (
            <li key={p.id} className="flex min-w-0 items-center gap-2 text-tiny">
              <Avatar userId={p.id} name={p.name} size={24} />
              <span className="truncate">{p.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-micro text-muted-foreground">{t('tickets.assignees.none')}</p>
      )}
      {ticket.canAssign && (
        <p className="text-micro text-muted-foreground">{t('tickets.assignees.hint')}</p>
      )}
      {change.isError && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </section>
  );
}
