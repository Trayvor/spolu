import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorCodes, type TicketDto } from '@spolu/shared';
import { EventSelect } from '@/features/projects/event-select';
import { ProjectChip } from '@/features/projects/project-chip';
import { ProjectSelect } from '@/features/projects/project-select';
import { ApiError } from '@/lib/api';
import { useSetTicketProject } from './api';

/**
 * The ticket's Project and Event in the details list (Phase 33 part P2, spec §6). Admins and the
 * group's clients (`canAssign` on a ticket with a client) get two selects that save at once
 * through `PUT /tickets/:id/project`; changing the project clears the event. Anyone else (a
 * žiadateľ) sees the project's name only; the server never sends them the event. A ticket
 * without a client shows nothing: projects are per client.
 */
export function TicketProject({ ticket }: { ticket: TicketDto }) {
  const { t } = useTranslation();
  const uid = useId();
  const save = useSetTicketProject(ticket.id);
  if (ticket.groupId === null) return null;
  const groupId = ticket.groupId;

  if (!ticket.canAssign) {
    if (!ticket.project) return null;
    return (
      <div className="flex flex-col gap-1">
        <dt className="text-micro font-semibold text-muted-foreground">
          {t('tickets.fields.project')}
        </dt>
        <dd className="min-w-0 text-button break-words">
          <ProjectChip project={ticket.project} event={ticket.event} className="text-button" />
        </dd>
      </div>
    );
  }

  // While a save runs, the selects show what was chosen.
  const pending = save.isPending ? save.variables : null;
  const projectId = pending ? pending.projectId : (ticket.project?.id ?? null);
  const eventId = pending ? pending.eventId : (ticket.event?.id ?? null);
  const error =
    save.error instanceof ApiError && save.error.code === ErrorCodes.invalidProject
      ? t('tickets.project.invalid')
      : save.isError
        ? t('errors.generic')
        : null;

  return (
    <>
      <div className="flex flex-col gap-1">
        <dt className="text-micro font-semibold text-muted-foreground">
          <label htmlFor={`${uid}-project`}>{t('tickets.fields.project')}</label>
        </dt>
        <dd className="min-w-0">
          <ProjectSelect
            id={`${uid}-project`}
            groupId={groupId}
            value={projectId}
            current={ticket.project}
            disabled={save.isPending}
            onChange={(next) => save.mutate({ projectId: next, eventId: null })}
            labels={{
              label: t('tickets.fields.project'),
              none: t('tickets.project.none'),
              archived: (name) => t('tickets.project.archived', { name }),
            }}
            className="w-full"
          />
          {error && (
            <p role="alert" className="mt-1 text-tiny text-error-ink">
              {error}
            </p>
          )}
        </dd>
      </div>
      {projectId !== null && (
        <div className="flex flex-col gap-1">
          <dt className="text-micro font-semibold text-muted-foreground">
            <label htmlFor={`${uid}-event`}>{t('tickets.fields.event')}</label>
          </dt>
          <dd className="min-w-0">
            <EventSelect
              // A new project starts a new list.
              key={projectId}
              id={`${uid}-event`}
              groupId={groupId}
              projectId={projectId}
              value={eventId}
              current={ticket.event}
              disabled={save.isPending}
              onChange={(next) => save.mutate({ projectId, eventId: next })}
              labels={{ label: t('tickets.fields.event'), none: t('tickets.project.noEvent') }}
              className="w-full"
            />
          </dd>
        </div>
      )}
    </>
  );
}
