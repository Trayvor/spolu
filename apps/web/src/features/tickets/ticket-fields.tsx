import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ErrorCodes,
  TicketStatuses,
  type TicketDto,
  type TicketPatchBody,
  type TicketStatus,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { groupsQuery, onlyClientGroups } from '@/features/groups/api';
import { ImagePreview } from '@/features/files/image-preview';
import { formatCreated, formatDue, todayInBratislava } from '@/features/tasks/dates';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAssignGroup, usePatchTicket } from './api';
import { DescriptionView } from '@/features/editor/description-field';
import { ContentFields, contentErrors, type ContentDraft } from './content-fields';
import { LinkOutIcon, ThumbDown, ThumbUp } from './icons';
import { isTicketOverdue, StatusBadge } from './status-badge';
import { TicketProject } from './ticket-project';
import { MoveProjectWarning } from './ticket-egrant';

type Draft = ContentDraft & { groupId: string };

const draftOf = (ticket: TicketDto): Draft => ({
  groupId: ticket.groupId ?? '',
  subject: ticket.subject ?? '',
  area: ticket.area ?? '',
  programme: ticket.programme ?? '',
  body: ticket.body ?? '',
  dueDate: ticket.dueDate ?? '',
  url: ticket.url ?? '',
  linked: ticket.linkedKnowledge,
});

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-micro font-semibold text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-button break-words">{children}</dd>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 font-semibold underline underline-offset-2 hover:text-neutral"
    >
      <span className="truncate">{children ?? href}</span>
      <LinkOutIcon />
    </a>
  );
}

/** The status: a select for admins (saved at once), the badge for everyone else. */
export function StatusControl({ ticket, editable }: { ticket: TicketDto; editable: boolean }) {
  const { t } = useTranslation();
  const patch = usePatchTicket(ticket.id);
  const id = useId();
  if (!editable) return <StatusBadge status={ticket.status} />;
  const value = patch.isPending ? (patch.variables.status ?? ticket.status) : ticket.status;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="sr-only">
        {t('tickets.fields.status')}
      </label>
      <Select
        id={id}
        value={value}
        disabled={patch.isPending}
        onChange={(e) => patch.mutate({ status: e.target.value as TicketStatus })}
        className="h-8 py-0 pr-9 pl-3 text-tiny font-semibold"
      >
        {TicketStatuses.map((status) => (
          <option key={status} value={status}>
            {t(`tickets.status.${status}`)}
          </option>
        ))}
      </Select>
      {patch.isError && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </div>
  );
}

/** The fields of the draft that the content PATCH carries, when any differs from the ticket. */
function contentPatch(ticket: TicketDto, draft: Draft): TicketPatchBody | null {
  const before = draftOf(ticket);
  const keys = ['subject', 'area', 'programme', 'body', 'dueDate', 'url'] as const;
  const ids = (draft.linked ?? []).map((k) => k.id);
  const linksChanged = ids.join() !== (before.linked ?? []).map((k) => k.id).join();
  if (!linksChanged && keys.every((key) => draft[key] === before[key])) return null;
  return {
    ...(Object.fromEntries(keys.map((key) => [key, draft[key]])) as TicketPatchBody),
    ...(linksChanged ? { knowledgeIds: ids } : {}),
  };
}

/**
 * The client in the edit form: a select of every client. A ticket without a client starts on
 * "Without client" (it cannot go back to none); a ticket with tasks keeps its client (the server
 * answers `409 has_tasks`), so the select is disabled and says why.
 */
function ClientSelect({
  ticket,
  value,
  onChange,
  error,
}: {
  ticket: TicketDto;
  value: string;
  onChange: (groupId: string) => void;
  error: string | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const groups = useQuery({ ...groupsQuery, select: onlyClientGroups }).data;
  const locked = ticket.groupId !== null && ticket.taskCount > 0;
  const reason = locked ? t('tickets.assign.hasTasks') : error;
  return (
    <div className="flex flex-col gap-2.5">
      <Label htmlFor={id}>{t('tickets.fields.client')}</Label>
      <Select
        id={id}
        value={value}
        disabled={!groups || locked}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={reason ? `${id}-reason` : undefined}
        aria-invalid={error ? true : undefined}
      >
        {ticket.groupId === null && <option value="">{t('tickets.row.noClient')}</option>}
        {/* The current client stays listed while the list loads. */}
        {!groups && ticket.groupId !== null && (
          <option value={ticket.groupId}>{ticket.groupName}</option>
        )}
        {(groups ?? []).map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </Select>
      {reason && (
        <p
          id={`${id}-reason`}
          role={error ? 'alert' : undefined}
          className={cn('text-tiny', error ? 'text-error-ink' : 'text-muted-foreground')}
        >
          {reason}
        </p>
      )}
    </div>
  );
}

/**
 * An admin's edit of the ticket: the client and the content fields of the new-ticket dialog.
 * Save moves the client first (`PUT /group`: the initiator is found again, riešitelia are checked,
 * the "Ticket created" email goes if it never went), then saves the content when it changed. A
 * failed move saves nothing; a ticket with tasks cannot move.
 */
function TicketEditor({ ticket, onClose }: { ticket: TicketDto; onClose: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(() => draftOf(ticket));
  const [errors, setErrors] = useState<ReturnType<typeof contentErrors>>({});
  const patch = usePatchTicket(ticket.id);
  const assign = useAssignGroup(ticket.id);
  const pending = patch.isPending || assign.isPending;
  const clientError =
    assign.error instanceof ApiError && assign.error.code === ErrorCodes.hasTasks
      ? t('tickets.assign.hasTasks')
      : assign.isError
        ? t('errors.generic')
        : null;

  const save = async () => {
    const found = contentErrors(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      if (draft.groupId !== '' && draft.groupId !== (ticket.groupId ?? '')) {
        await assign.mutateAsync(draft.groupId);
      }
      const changes = contentPatch(ticket, draft);
      if (changes) await patch.mutateAsync(changes);
      onClose();
    } catch {
      // Shown from the mutation's state; the form stays open with the draft.
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      aria-label={t('tickets.page.editTitle')}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <ClientSelect
        ticket={ticket}
        value={draft.groupId}
        onChange={(groupId) => {
          assign.reset();
          setDraft({ ...draft, groupId });
        }}
        error={clientError}
      />
      <MoveProjectWarning ticket={ticket} groupId={draft.groupId} />
      <ContentFields
        // The editor and its knowledge follow the ticket's saved client; a move saves first.
        groupId={ticket.groupId}
        draft={draft}
        onChange={(next) => setDraft({ ...next, groupId: draft.groupId })}
        errors={errors}
      />
      {patch.isError && (
        <p role="alert" className="text-tiny text-error-ink">
          {t('errors.generic')}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t('tickets.page.save')}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('tickets.page.cancel')}
        </Button>
      </div>
    </form>
  );
}

/**
 * The ticket's text and fields as a definition list: the initiator (name, email, phone), area,
 * the client ("Without client" for none), programme, due date (red when overdue), URL, the
 * instance link eGrant sent, the files, then when it was created and resolved. An admin edits
 * the client and the content in place ("Edit", Save or Cancel).
 */
export function TicketFields({ ticket, editable }: { ticket: TicketDto; editable: boolean }) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const lang = i18n.language;

  if (editing) return <TicketEditor ticket={ticket} onClose={() => setEditing(false)} />;

  const overdue = isTicketOverdue(ticket.dueDate, ticket.status, todayInBratislava());
  const { requester } = ticket;
  return (
    <div className="flex flex-col gap-4">
      {/* Phase 33 part P5: the text is Markdown now, shown like a chat message. A reader who
          does not use the board (a žiadateľ) opens the attached items through the ticket. */}
      {(ticket.body || ticket.linkedKnowledge.length > 0) && (
        <DescriptionView
          body={ticket.body ?? ''}
          groupId={ticket.groupId}
          linked={ticket.linkedKnowledge}
          nameOf={() => undefined}
          via={ticket.tasks === null ? { kind: 'ticket', id: ticket.id } : null}
          subject={{ kind: 'ticket', id: ticket.id }}
          className="text-button font-medium break-words"
        />
      )}
      <dl className="grid gap-x-6 gap-y-4 min-[641px]:grid-cols-2 lg:grid-cols-1">
        <Row label={t('tickets.fields.initiator')}>
          {requester.name || requester.email || requester.phone ? (
            <span className="flex flex-col">
              {requester.name && <span className="font-semibold">{requester.name}</span>}
              {requester.email && (
                <a href={`mailto:${requester.email}`} className="underline underline-offset-2">
                  {requester.email}
                </a>
              )}
              {requester.phone && (
                <a href={`tel:${requester.phone}`} className="underline underline-offset-2">
                  {requester.phone}
                </a>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('tickets.fields.unknown')}</span>
          )}
        </Row>
        {ticket.area && <Row label={t('tickets.fields.area')}>{ticket.area}</Row>}
        <Row label={t('tickets.fields.client')}>
          {ticket.groupName ?? (
            <span className="text-muted-foreground">{t('tickets.row.noClient')}</span>
          )}
        </Row>
        <TicketProject ticket={ticket} />
        {ticket.programme && <Row label={t('tickets.fields.programme')}>{ticket.programme}</Row>}
        {ticket.dueDate && (
          <Row label={t('tickets.fields.dueDate')}>
            <span className={cn(overdue && 'font-semibold text-error-ink')}>
              {formatDue(ticket.dueDate, lang)}
              {overdue && ` (${t('tickets.fields.overdue')})`}
            </span>
          </Row>
        )}
        {ticket.url && (
          <Row label={t('tickets.fields.url')}>
            <ExternalLink href={ticket.url} />
          </Row>
        )}
        {ticket.instanceUrl && (
          <Row label={t('tickets.fields.instance')}>
            <span className="break-all">{ticket.instanceUrl}</span>
          </Row>
        )}
        {ticket.files.length > 0 && (
          <Row label={t('tickets.fields.files')}>
            <ul role="list" className="flex flex-col gap-2">
              {ticket.files.map((file) => (
                <li key={file.id}>
                  <ImagePreview file={file} maxWidth={240} />
                </li>
              ))}
            </ul>
          </Row>
        )}
        <Row label={t('tickets.fields.created')}>
          {formatCreated(ticket.createdAt, lang)}
          <span className="text-muted-foreground">
            {' '}
            {t(ticket.source === 'api' ? 'tickets.fields.fromEgrant' : 'tickets.fields.inSpolu')}
          </span>
        </Row>
        {ticket.resolvedAt && (
          <Row label={t('tickets.fields.resolved')}>{formatCreated(ticket.resolvedAt, lang)}</Row>
        )}
        {/* 2026-10-19: every rating with its comment, for admins only (`ratings` is null for
            everyone else). */}
        {ticket.ratings !== null && (ticket.status === 'resolved' || ticket.ratings.length > 0) && (
          <Row label={t('tickets.rating.row')}>
            <TicketRatings ratings={ticket.ratings} lang={lang} />
          </Row>
        )}
      </dl>
      {editable && (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => setEditing(true)}
        >
          {t('tickets.page.edit')}
        </Button>
      )}
    </div>
  );
}

/** The admins' list of a ticket's ratings: thumb, rater, date, and the comment as plain text. */
function TicketRatings({
  ratings,
  lang,
}: {
  ratings: NonNullable<TicketDto['ratings']>;
  lang: string;
}) {
  const { t } = useTranslation();
  if (ratings.length === 0) {
    return <span className="text-muted-foreground">{t('tickets.rating.none')}</span>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {ratings.map((r) => (
        <li key={r.userId} className="flex flex-col gap-1">
          <span className="flex items-center gap-2 font-semibold">
            {r.value === 'up' ? <ThumbUp /> : <ThumbDown />}
            {t(`tickets.rating.${r.value}`)}
          </span>
          <span className="text-tiny text-muted-foreground">
            {[r.name, formatCreated(r.ratedAt, lang)].filter(Boolean).join(' · ')}
          </span>
          {r.comment && (
            <p className="whitespace-pre-line text-muted-foreground">{r.comment}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
