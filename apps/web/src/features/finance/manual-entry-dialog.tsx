import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDuration, parseDuration, type WorkLogEntry } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import type { FinanceView } from './api';
import { DialogFrame } from './dialog-frame';
import { ratesQuery, useAddManualEntry, useUpdateEntry } from './log-api';
import { today } from './period';

/**
 * A manual time entry (spec §6.3: "admin X spent N on day D", finance admins only) or the edit
 * of an entry from the work log: a manual one takes the day, duration and note; a task or ticket
 * entry its duration only (filling a request answers it). 0 is a valid duration; the day is
 * never in the future. The admins come from the rates list (every active admin, and every
 * deactivated one with a rate).
 */
export function EntryDialog({
  view,
  groupId,
  entry,
  onClose,
}: {
  view: FinanceView;
  groupId: string;
  entry?: WorkLogEntry;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const durationRef = useRef<HTMLInputElement>(null);
  const manual = !entry || entry.source === 'manual';
  const admins = useQuery({ ...ratesQuery(view), enabled: !entry }).data?.admins;
  const [userId, setUserId] = useState(entry?.userId ?? '');
  const [day, setDay] = useState(entry?.workedOn ?? today());
  const [duration, setDuration] = useState(
    entry?.minutes != null ? formatDuration(entry.minutes, { hours: 'h', minutes: 'm' }) : '',
  );
  const [note, setNote] = useState(entry?.note ?? '');
  const [errors, setErrors] = useState<{ user?: string; day?: string; duration?: string }>({});
  const add = useAddManualEntry(view, groupId);
  const update = useUpdateEntry(view);
  const pending = add.isPending || update.isPending;
  const failed = add.isError || update.isError;

  const submit = () => {
    const minutes = parseDuration(duration);
    const found: typeof errors = {};
    if (!entry && !userId) found.user = 'financeLog.entry.errors.user';
    if (manual && (!day || day > today())) found.day = 'financeLog.entry.errors.day';
    if (minutes === null) found.duration = 'financeLog.entry.errors.duration';
    setErrors(found);
    if (Object.keys(found).length > 0 || minutes === null) return;
    if (!entry) {
      add.mutate({ userId, workedOn: day, minutes, note: note.trim() }, { onSuccess: onClose });
    } else {
      update.mutate(
        {
          id: entry.id,
          patch: manual ? { minutes, workedOn: day, note: note.trim() } : { minutes },
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
