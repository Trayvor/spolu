import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MEETING_LIMITS } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  isoToLocal,
  localToIso,
  newRowKey,
  type ReminderTimeValue,
} from '@/features/reminders/reminder-times-field';
import { transcriptFromFile } from './meeting-api';
import type { KnowledgeFormErrors, MeetingFormValue } from './knowledge-form';

const FIELD = 'flex flex-col gap-2.5';
const REMIND_BEFORE_MS = 15 * 60_000;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-tiny text-error-ink">
      {message}
    </p>
  );
}

/** The reminder time 15 minutes before the meeting, or null when that has passed. */
export function timeBefore(meeting: MeetingFormValue, now = Date.now()): ReminderTimeValue | null {
  const iso = localToIso(meeting.date, meeting.time);
  if (!iso) return null;
  const at = Date.parse(iso) - REMIND_BEFORE_MS;
  if (at < now + 60_000) return null;
  return { key: newRowKey(), ...isoToLocal(new Date(at).toISOString()), firedAt: null };
}

/**
 * The date and time of a meeting (required, first) and its three optional links. Needs the
 * `knowledge` namespace.
 */
export function MeetingWhenAndLinks({
  value,
  onChange,
  errors,
}: {
  value: MeetingFormValue;
  onChange: (next: MeetingFormValue) => void;
  errors: KnowledgeFormErrors;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const set = (patch: Partial<MeetingFormValue>) => onChange({ ...value, ...patch });
  const links = [
    {
      field: 'meetingUrl',
      label: t('knowledge.meeting.meetingUrl'),
      hint: t('knowledge.meeting.meetingUrlHint'),
    },
    { field: 'recordingUrl', label: t('knowledge.meeting.recordingUrl'), hint: undefined },
    { field: 'transcriptUrl', label: t('knowledge.meeting.transcriptUrl'), hint: undefined },
  ] as const;

  return (
    <>
      <fieldset className={FIELD} aria-describedby={errors.when ? id('when-error') : undefined}>
        <legend className="mb-2.5 text-button font-semibold">{t('knowledge.meeting.when')}</legend>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label={t('knowledge.meeting.date')}
            value={value.date}
            aria-invalid={!!errors.when || undefined}
            onChange={(event) => set({ date: event.target.value })}
            className="min-w-0 flex-[3] px-3"
          />
          <Input
            type="time"
            aria-label={t('knowledge.meeting.time')}
            value={value.time}
            aria-invalid={!!errors.when || undefined}
            onChange={(event) => set({ time: event.target.value })}
            className="min-w-0 flex-[2] px-3"
          />
        </div>
        <FieldError id={id('when-error')} message={errors.when} />
      </fieldset>
      {links.map(({ field, label, hint }) => (
        <div key={field} className={FIELD}>
          <Label htmlFor={id(field)}>{label}</Label>
          <Input
            id={id(field)}
            type="url"
            inputMode="url"
            placeholder="https://"
            value={value[field]}
            aria-invalid={!!errors[field] || undefined}
            aria-describedby={
              errors[field] ? id(`${field}-error`) : hint ? id(`${field}-hint`) : undefined
            }
            onChange={(event) => set({ [field]: event.target.value })}
          />
          {hint && !errors[field] && (
            <p id={id(`${field}-hint`)} className="text-tiny text-muted-foreground">
              {hint}
            </p>
          )}
          <FieldError id={id(`${field}-error`)} message={errors[field]} />
        </div>
      ))}
    </>
  );
}

/** The transcript: a plain text area, filled by typing, pasting or loading a file. */
export function MeetingTranscriptField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  async function load(file: File) {
    setReading(true);
    setFileError(null);
    try {
      onChange(await transcriptFromFile(file));
    } catch {
      setFileError(t('knowledge.meeting.transcriptFileFailed'));
    } finally {
      setReading(false);
    }
  }

  const message = error ?? fileError ?? undefined;
  return (
    <div className={FIELD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={`${uid}-transcript`}>{t('knowledge.meeting.transcript')}</Label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-disabled={reading}
          onClick={() => !reading && input.current?.click()}
        >
          {reading
            ? t('knowledge.meeting.readingTranscript')
            : t('knowledge.meeting.loadTranscript')}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".txt,.vtt,.srt,.docx,text/plain,text/vtt"
          className="hidden"
          data-testid="meeting-transcript-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void load(file);
          }}
        />
      </div>
      <textarea
        id={`${uid}-transcript`}
        value={value}
        maxLength={MEETING_LIMITS.transcript}
        rows={6}
        aria-invalid={!!message || undefined}
        aria-describedby={message ? `${uid}-error` : `${uid}-hint`}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-32 w-full rounded-md border-2 border-input bg-card px-[18px] py-[13px] text-button text-foreground focus:border-foreground focus:outline-none"
      />
      {message ? (
        <p id={`${uid}-error`} role="alert" className="text-tiny text-error-ink">
          {message}
        </p>
      ) : (
        <p id={`${uid}-hint`} className="text-tiny text-muted-foreground">
          {t('knowledge.meeting.transcriptHint')}
        </p>
      )}
    </div>
  );
}
