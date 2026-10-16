import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TicketStatuses, type TicketDto, type TicketStatus } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ImagePreview } from '@/features/files/image-preview';
import { formatCreated, formatDue, todayInBratislava } from '@/features/tasks/dates';
import { cn } from '@/lib/utils';
import { usePatchTicket } from './api';
import { ContentFields, contentErrors, type ContentDraft } from './content-fields';
import { LinkOutIcon } from './icons';
import { isTicketOverdue, StatusBadge } from './status-badge';

const draftOf = (ticket: TicketDto): ContentDraft => ({
  subject: ticket.subject ?? '',
  area: ticket.area ?? '',
  programme: ticket.programme ?? '',
  body: ticket.body ?? '',
  dueDate: ticket.dueDate ?? '',
  url: ticket.url ?? '',
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

/** The last path segment of a link, as its name ("a.png" for https://x.sk/f/a.png). */
function linkName(href: string): string {
  try {
    const url = new URL(href);
    const last = url.pathname.split('/').filter(Boolean).at(-1);
    return last ? decodeURIComponent(last) : url.host;
  } catch {
    return href;
  }
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

/**
 * The ticket's text and fields as a definition list: the initiator (name, email, phone), area,
 * programme, due date (red when overdue), URL, the instance link eGrant sent, links to files,
 * the uploaded files, then when it was created and resolved. An admin edits the content in place
 * ("Edit": the same fields as the new-ticket dialog, Save or Cancel).
 */
export function TicketFields({ ticket, editable }: { ticket: TicketDto; editable: boolean }) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState<ContentDraft | null>(null);
  const [errors, setErrors] = useState<ReturnType<typeof contentErrors>>({});
  const patch = usePatchTicket(ticket.id);
  const lang = i18n.language;

  if (draft) {
    const save = () => {
      const found = contentErrors(draft);
      setErrors(found);
      if (Object.keys(found).length > 0) return;
      patch.mutate(
        {
          subject: draft.subject,
          area: draft.area,
          programme: draft.programme,
          body: draft.body,
          dueDate: draft.dueDate,
          url: draft.url,
        },
        { onSuccess: () => setDraft(null) },
      );
    };
    return (
      <form
        className="flex flex-col gap-4"
        aria-label={t('tickets.page.editTitle')}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <ContentFields draft={draft} onChange={setDraft} errors={errors} />
        {patch.isError && (
          <p role="alert" className="text-tiny text-error-ink">
            {t('errors.generic')}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={patch.isPending}>
            {t('tickets.page.save')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(null);
              setErrors({});
              patch.reset();
            }}
          >
            {t('tickets.page.cancel')}
          </Button>
        </div>
      </form>
    );
  }

  const overdue = isTicketOverdue(ticket.dueDate, ticket.status, todayInBratislava());
  const { requester } = ticket;
  return (
    <div className="flex flex-col gap-4">
      {ticket.body && (
        <p className="text-button font-medium whitespace-pre-wrap break-words">{ticket.body}</p>
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
        {ticket.fileLinks.length > 0 && (
          <Row label={t('tickets.fields.fileLinks')}>
            <ul className="flex flex-col gap-1">
              {ticket.fileLinks.map((href) => (
                <li key={href} className="min-w-0">
                  <ExternalLink href={href}>{linkName(href)}</ExternalLink>
                </li>
              ))}
            </ul>
          </Row>
        )}
        {ticket.files.length > 0 && (
          <Row label={t('tickets.fields.files')}>
            <ul className="flex flex-col gap-2">
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
      </dl>
      {editable && (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => setDraft(draftOf(ticket))}
        >
          {t('tickets.page.edit')}
        </Button>
      )}
    </div>
  );
}
