import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { TICKET_LIMITS, type FileInfo, type TicketDto } from '@spolu/shared';
import { FilesField } from '@/components/files-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelHeader } from '@/components/ui/panel-header';
import { Select } from '@/components/ui/select';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { groupsQuery } from '@/features/groups/api';
import { cn } from '@/lib/utils';
import { useCreateTicket } from './api';
import {
  ContentFields,
  contentErrors,
  EMPTY_CONTENT,
  textareaClass,
  type ContentDraft,
} from './content-fields';

type Errors = Partial<Record<keyof ContentDraft | 'client' | 'email' | 'links', string>>;

const isHttp = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A new ticket in a `SheetDialog`. An admin chooses the client (fixed when opened from a group's
 * tab) and names the initiator by email, name and phone, with the hint that they get an email
 * and can follow the ticket; a client creates in their group and is the initiator, so those
 * fields are not there. Then the content fields, links to files (one per line, at most 20) and
 * uploaded files (once the client is known: they belong to it). `onCreated` gets the ticket.
 */
export function NewTicketDialog({
  admin,
  groupId: fixedGroupId,
  onClose,
  onCreated,
}: {
  admin: boolean;
  groupId?: string;
  onClose: () => void;
  onCreated: (ticket: TicketDto) => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const subjectRef = useRef<HTMLInputElement>(null);
  const groups = useQuery({ ...groupsQuery, enabled: admin && !fixedGroupId }).data;
  const [groupId, setGroupId] = useState(fixedGroupId ?? '');
  const [content, setContent] = useState<ContentDraft>(EMPTY_CONTENT);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [links, setLinks] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const create = useCreateTicket();

  const chooseGroup = (next: string) => {
    setGroupId(next);
    setFiles([]); // uploads belong to the client they were made for
  };

  const submit = () => {
    const found: Errors = contentErrors(content);
    const fileLinks = links
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!groupId) found.client = 'tickets.form.errors.client';
    if (admin && email.trim() && !EMAIL.test(email.trim()))
      found.email = 'tickets.form.errors.email';
    if (fileLinks.length > TICKET_LIMITS.fileLinks || fileLinks.some((l) => !isHttp(l))) {
      found.links = 'tickets.form.errors.links';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    create.mutate(
      {
        groupId,
        requesterEmail: admin ? email.trim() || null : null,
        requesterName: admin ? name : null,
        requesterPhone: admin ? phone : null,
        subject: content.subject,
        area: content.area,
        programme: content.programme,
        body: content.body,
        dueDate: content.dueDate || null,
        url: content.url,
        fileLinks,
        fileIds: files.map((f) => f.id),
      },
      { onSuccess: onCreated },
    );
  };

  const error = (key: keyof Errors) =>
    errors[key] && (
      <p id={id(`${key}-error`)} role="alert" className="text-tiny text-error-ink">
        {t(errors[key])}
      </p>
    );
  const described = (key: keyof Errors) =>
    errors[key] ? { 'aria-invalid': true, 'aria-describedby': id(`${key}-error`) } : {};

  return (
    <SheetDialog onEscape={onClose} initialFocus={subjectRef} testId="new-ticket">
      <PanelHeader onClose={onClose} compactBelow={641} backLabel={t('tickets.form.back')}>
        <span />
      </PanelHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 min-[641px]:px-6 min-[641px]:py-5">
          <SheetDialogTitle className="text-medium font-semibold">
            {t('tickets.form.title')}
          </SheetDialogTitle>
          {admin && !fixedGroupId && (
            <div className="flex flex-col gap-2.5">
              <Label htmlFor={id('client')}>{t('tickets.fields.client')}</Label>
              <Select
                id={id('client')}
                value={groupId}
                disabled={!groups}
                onChange={(e) => chooseGroup(e.target.value)}
                {...described('client')}
              >
                <option value="">{t('tickets.assign.choose')}</option>
                {(groups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
              {error('client')}
            </div>
          )}
          {admin && (
            <fieldset className="flex flex-col gap-4 rounded-lg bg-muted p-4">
              <legend className="sr-only">{t('tickets.form.initiator')}</legend>
              <p className="text-tiny text-muted-foreground">{t('tickets.form.initiatorHint')}</p>
              <div className="flex flex-col gap-2.5">
                <Label htmlFor={id('email')}>{t('tickets.form.email')}</Label>
                <Input
                  id={id('email')}
                  type="email"
                  value={email}
                  maxLength={TICKET_LIMITS.email}
                  onChange={(e) => setEmail(e.target.value)}
                  {...described('email')}
                />
                {error('email')}
              </div>
              <div className="grid gap-4 min-[641px]:grid-cols-2">
                <div className="flex flex-col gap-2.5">
                  <Label htmlFor={id('name')}>{t('tickets.form.name')}</Label>
                  <Input
                    id={id('name')}
                    value={name}
                    maxLength={TICKET_LIMITS.name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2.5">
                  <Label htmlFor={id('phone')}>{t('tickets.form.phone')}</Label>
                  <Input
                    id={id('phone')}
                    type="tel"
                    value={phone}
                    maxLength={TICKET_LIMITS.phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
            </fieldset>
          )}
          <ContentFields
            draft={content}
            onChange={setContent}
            errors={errors}
            subjectRef={subjectRef}
          />
          <div className="flex flex-col gap-2.5">
            <Label htmlFor={id('links')}>{t('tickets.fields.fileLinks')}</Label>
            <textarea
              id={id('links')}
              rows={3}
              value={links}
              placeholder={t('tickets.form.linksPlaceholder')}
              onChange={(e) => setLinks(e.target.value)}
              className={cn(textareaClass, 'resize-y')}
              {...described('links')}
            />
            {error('links')}
          </div>
          <div className="flex flex-col gap-2.5">
            <span id={id('files')} className="text-micro font-semibold text-muted-foreground">
              {t('tickets.fields.files')}
            </span>
            {groupId ? (
              <FilesField
                groupId={groupId}
                fileIds={files.map((f) => f.id)}
                files={files}
                onAdd={(file) => setFiles((list) => [...list, file])}
                onRemove={(fileId) => setFiles((list) => list.filter((f) => f.id !== fileId))}
                labelId={id('files')}
                max={TICKET_LIMITS.files}
                inputTestId="ticket-file-input"
              />
            ) : (
              <p className="text-tiny text-muted-foreground">
                {t('tickets.form.filesAfterClient')}
              </p>
            )}
          </div>
        </div>
        <footer className="flex flex-col gap-2 border-t-2 border-border px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] min-[641px]:px-6">
          {create.isError && (
            <p role="alert" className="text-tiny text-error-ink">
              {t('errors.generic')}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              {t('tickets.page.cancel')}
            </Button>
            <Button type="submit" size="lg" disabled={create.isPending}>
              {t('tickets.form.create')}
            </Button>
          </div>
        </footer>
      </form>
    </SheetDialog>
  );
}
