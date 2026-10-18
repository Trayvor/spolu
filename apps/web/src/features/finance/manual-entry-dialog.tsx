import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDuration, parseDuration, type WorkLogEntry } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { groupsQuery } from '@/features/groups/api';
import { EventSelect } from '@/features/projects/event-select';
import { ProjectSelect } from '@/features/projects/project-select';
import type { FinanceView } from './api';
import { DialogFrame } from './dialog-frame';
import { ratesQuery, useAddManualEntry, useAddSystemEntry, useUpdateEntry } from './log-api';
import { today } from './period';

/**
 * A manual time entry (spec §6.3: "admin X spent N on day D", finance admins only) or the edit
 * of an entry from the work log: a manual one takes the day, duration and note; a task or ticket
 * entry its duration only (filling a request answers it). 0 is a valid duration; the day is
 * never in the future. The admins come from the rates list (every active admin, and every
 * deactivated one with a rate). Without a `groupId` (the work log of `/finance`) the dialog
 * starts with a client picker: every client, or "Without client" (decision 24). A manual entry
 * of a client may name one of its projects and that project's event (Phase 33 P6).
 */

/** The picker's value for "Without client". */
const NO_CLIENT = '-';
export function EntryDialog({
  view,
  groupId,
  entry,
  onClose,
}: {
  view: FinanceView;
  /** The client of a tab; absent on `/finance`, where a new entry picks its client. */
  groupId?: string;
  entry?: WorkLogEntry;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const durationRef = useRef<HTMLInputElement>(null);
  const manual = !entry || entry.source === 'manual';
  const pickClient = !entry && groupId === undefined;
  const admins = useQuery({ ...ratesQuery(view), enabled: !entry }).data?.admins;
  const clients = useQuery({ ...groupsQuery, enabled: pickClient }).data;
  const [client, setClient] = useState('');
  const [userId, setUserId] = useState(entry?.userId ?? '');
  const [day, setDay] = useState(entry?.workedOn ?? today());
  const [duration, setDuration] = useState(
    entry?.minutes != null ? formatDuration(entry.minutes, { hours: 'h', minutes: 'm' }) : '',
  );
  const [note, setNote] = useState(entry?.note ?? '');
  const [projectId, setProjectId] = useState<string | null>(entry?.projectId ?? null);
  const [eventId, setEventId] = useState<string | null>(entry?.eventId ?? null);
  // The client whose projects a manual entry may name (none: "Without client" or not chosen yet).
  const projectGroup = !manual
    ? null
    : pickClient
      ? client && client !== NO_CLIENT
        ? client
        : null
      : (groupId ?? entry?.groupId ?? null);
  const [errors, setErrors] = useState<{
    client?: string;
    user?: string;
    day?: string;
    duration?: string;
  }>({});
  const add = useAddManualEntry(view, groupId ?? '');
  const addSystem = useAddSystemEntry(view);
  const update = useUpdateEntry(view);
  const pending = add.isPending || addSystem.isPending || update.isPending;
  const failed = add.isError || addSystem.isError || update.isError;

  const submit = () => {
    const minutes = parseDuration(duration);
    const found: typeof errors = {};
    if (pickClient && !client) found.client = 'financeSystem.entry.errors.client';
    if (!entry && !userId) found.user = 'financeLog.entry.errors.user';
    if (manual && (!day || day > today())) found.day = 'financeLog.entry.errors.day';
    if (minutes === null) found.duration = 'financeLog.entry.errors.duration';
    setErrors(found);
    if (Object.keys(found).length > 0 || minutes === null) return;
    const pair = projectGroup ? { projectId, eventId: projectId ? eventId : null } : null;
    const body = {
      userId,
      workedOn: day,
      minutes,
      note: note.trim(),
      projectId: pair?.projectId ?? null,
      eventId: pair?.eventId ?? null,
    };
    if (pickClient) {
      addSystem.mutate(
        { ...body, groupId: client === NO_CLIENT ? null : client },
        { onSuccess: onClose },
      );
    } else if (!entry) {
      add.mutate(body, { onSuccess: onClose });
    } else {
      update.mutate(
        {
          id: entry.id,
          patch: manual
            ? { minutes, workedOn: day, note: note.trim(), ...(pair ?? {}) }
            : { minutes },
        },
        { onSuccess: onClose },
      );
    }
  };

  const described = (key: keyof typeof errors) =>
    errors[key] ? { 'aria-invalid': true, 'aria-describedby': id(`${key}-error`) } : {};
  const error = (key: keyof typeof errors) =>
    errors[key] && (
      <p id={id(`${key}-error`)} role="alert" className="text-tiny text-error-ink">
        {t(errors[key])}
      </p>
    );

  const title = !entry
    ? t('financeLog.entry.addTitle')
    : entry.minutes === null
      ? t('financeLog.entry.fillTitle', { name: entry.userName })
      : t('financeLog.entry.editTitle', { name: entry.userName });

  return (
    <SheetDialog onEscape={onClose} initialFocus={durationRef} testId="finance-entry">
      <DialogFrame
        onClose={onClose}
        onSubmit={submit}
        title={<SheetDialogTitle className="text-medium font-semibold">{title}</SheetDialogTitle>}
        footer={
          <>
            {failed && (
              <p role="alert" className="mr-auto text-tiny text-error-ink">
                {t('financeLog.saveFailed')}
              </p>
            )}
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              {t('financeLog.cancel')}
            </Button>
            <Button type="submit" size="lg" disabled={pending}>
              {t('financeLog.save')}
            </Button>
          </>
        }
      >
        {entry && !manual && entry.title && (
          <p className="text-button text-muted-foreground">{entry.title}</p>
        )}
        {pickClient && (
          <div className="flex flex-col gap-2.5">
            <Label htmlFor={id('client')}>{t('financeSystem.entry.client')}</Label>
            <Select
              id={id('client')}
              value={client}
              disabled={!clients}
              onChange={(e) => {
                setClient(e.target.value);
                setProjectId(null);
                setEventId(null);
              }}
              {...described('client')}
            >
              <option value="">{t('financeSystem.entry.chooseClient')}</option>
              <option value={NO_CLIENT}>{t('financeSystem.noClient')}</option>
              {(clients ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            {error('client')}
          </div>
        )}
        {!entry && (
          <div className="flex flex-col gap-2.5">
            <Label htmlFor={id('user')}>{t('financeLog.entry.admin')}</Label>
            <Select
              id={id('user')}
              value={userId}
              disabled={!admins}
              onChange={(e) => setUserId(e.target.value)}
              {...described('user')}
            >
              <option value="">{t('financeLog.entry.chooseAdmin')}</option>
              {(admins ?? []).map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.active ? a.name : t('financeLog.entry.inactive', { name: a.name })}
                </option>
              ))}
            </Select>
            {error('user')}
          </div>
        )}
        <div className="grid gap-4 min-[641px]:grid-cols-2">
          {manual && (
            <div className="flex flex-col gap-2.5">
              <Label htmlFor={id('day')}>{t('financeLog.entry.day')}</Label>
              <Input
                id={id('day')}
                type="date"
                value={day}
                max={today()}
                onChange={(e) => setDay(e.target.value)}
                {...described('day')}
              />
              {error('day')}
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            <Label htmlFor={id('duration')}>{t('financeLog.entry.duration')}</Label>
            <Input
              ref={durationRef}
              id={id('duration')}
              value={duration}
              inputMode="text"
              placeholder="1:30"
              onChange={(e) => setDuration(e.target.value)}
              {...described('duration')}
            />
            <p className="text-tiny text-muted-foreground">{t('financeLog.entry.durationHint')}</p>
            {error('duration')}
          </div>
        </div>
        {projectGroup && (
          <div className="grid gap-4 min-[641px]:grid-cols-2">
            <div className="flex flex-col gap-2.5">
              <Label htmlFor={id('project')}>{t('financeLog.projects.label')}</Label>
              <ProjectSelect
                id={id('project')}
                groupId={projectGroup}
                value={projectId}
                onChange={(next) => {
                  setProjectId(next);
                  setEventId(null);
                }}
                labels={{
                  label: t('financeLog.projects.label'),
                  none: t('financeLog.projects.noProject'),
                  archived: (name) => t('financeLog.projects.archived', { name }),
                }}
              />
            </div>
            {projectId && (
              <div className="flex flex-col gap-2.5">
                <Label htmlFor={id('event')}>{t('financeLog.projects.eventLabel')}</Label>
                <EventSelect
                  id={id('event')}
                  groupId={projectGroup}
                  projectId={projectId}
                  value={eventId}
                  onChange={setEventId}
                  labels={{
                    label: t('financeLog.projects.eventLabel'),
                    none: t('financeLog.projects.noEvent'),
                  }}
                />
              </div>
            )}
          </div>
        )}
        {manual && (
          <div className="flex flex-col gap-2.5">
            <Label htmlFor={id('note')}>{t('financeLog.entry.note')}</Label>
            <Input
              id={id('note')}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}
      </DialogFrame>
    </SheetDialog>
  );
}
