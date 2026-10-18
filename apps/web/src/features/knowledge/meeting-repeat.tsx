import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  MEETING_SERIES_LIMITS,
  weekdayOrdinal,
  zonedTime,
  type MeetingRepeatFrequency,
  type MeetingRepeat,
  type MeetingSeriesInfo,
} from '@spolu/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { localToIso } from '@/features/reminders/reminder-times-field';
import { RepeatIcon } from './icons';

// Recurring calls (ADR 0049): the "Repeat" field of a new call and the series line of its
// detail. Needs the `knowledge` namespace.

export type RepeatFormValue = {
  frequency: 'none' | MeetingRepeatFrequency;
  end: 'never' | 'until' | 'count';
  /** `YYYY-MM-DD`, the last day. */
  until: string;
  count: string;
};

export const emptyRepeat = (): RepeatFormValue => ({
  frequency: 'none',
  end: 'never',
  until: '',
  count: '10',
});

const FREQUENCIES: MeetingRepeatFrequency[] = [
  'weekly',
  'biweekly',
  'monthly_date',
  'monthly_weekday',
];

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const locale = (language: string) => (/^en\b/.test(language) ? 'en-GB' : language);

/** How the rule reads for a call starting at `start` (its weekday, day or weekday of the month). */
export function ruleLabel(
  t: TFunction,
  language: string,
  frequency: MeetingRepeatFrequency,
  start: Date,
  timeZone: string,
): string {
  const weekday = new Intl.DateTimeFormat(locale(language), { weekday: 'long', timeZone }).format(
    start,
  );
  const day = zonedTime(start, timeZone).day;
  if (frequency === 'monthly_date') return t('knowledge.meeting.repeat.monthly_date', { day });
  if (frequency === 'monthly_weekday') {
    return t(`knowledge.meeting.repeat.monthly_weekday_${weekdayOrdinal(day)}`, { weekday });
  }
  return t(`knowledge.meeting.repeat.${frequency}`, { weekday });
}

/** The repeat of a new call as the API takes it; null when it does not repeat. */
export function repeatInput(value: RepeatFormValue): MeetingRepeat | null {
  if (value.frequency === 'none') return null;
  return {
    frequency: value.frequency,
    timeZone: browserZone(),
    until: value.end === 'until' ? value.until : null,
    count: value.end === 'count' ? Number(value.count) : null,
  };
}

/** The error of the end fields, or undefined. `date` is the first call's day. */
export function repeatError(
  t: TFunction,
  value: RepeatFormValue,
  date: string,
): string | undefined {
  if (value.frequency === 'none') return undefined;
  if (value.end === 'count') {
    const n = Number(value.count);
    const ok =
      Number.isInteger(n) &&
      n >= MEETING_SERIES_LIMITS.minCount &&
      n <= MEETING_SERIES_LIMITS.maxCount;
    return ok ? undefined : t('knowledge.meeting.repeat.countInvalid');
  }
  if (value.end === 'until') {
    const latest = `${Number(date.slice(0, 4)) + MEETING_SERIES_LIMITS.maxYearsAhead}${date.slice(4)}`;
    const ok =
      /^\d{4}-\d{2}-\d{2}$/.test(value.until) && value.until >= date && value.until <= latest;
    return ok ? undefined : t('knowledge.meeting.repeat.untilInvalid');
  }
  return undefined;
}

/** "Repeat" and, for a repeating call, how it ends. Only on a new call. */
export function MeetingRepeatField({
  value,
  onChange,
  date,
  time,
  error,
}: {
  value: RepeatFormValue;
  onChange: (next: RepeatFormValue) => void;
  date: string;
  time: string;
  error?: string;
}) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const iso = localToIso(date, time);
  const start = iso ? new Date(iso) : null;
  const zone = browserZone();
  const set = (patch: Partial<RepeatFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-2.5">
      <Label htmlFor={`${uid}-frequency`}>{t('knowledge.meeting.repeat.label')}</Label>
      <Select
        id={`${uid}-frequency`}
        value={value.frequency}
        onChange={(event) => set({ frequency: event.target.value as RepeatFormValue['frequency'] })}
      >
        <option value="none">{t('knowledge.meeting.repeat.none')}</option>
        {start &&
          FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {ruleLabel(t, i18n.language, f, start, zone)}
            </option>
          ))}
      </Select>
      {value.frequency !== 'none' && (
        <>
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2.5 text-button font-semibold">
              {t('knowledge.meeting.repeat.ends')}
            </legend>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label={t('knowledge.meeting.repeat.ends')}
                value={value.end}
                onChange={(event) => set({ end: event.target.value as RepeatFormValue['end'] })}
                containerClassName="min-w-0 flex-[3]"
              >
                <option value="never">{t('knowledge.meeting.repeat.endNever')}</option>
                <option value="until">{t('knowledge.meeting.repeat.endUntil')}</option>
                <option value="count">{t('knowledge.meeting.repeat.endCount')}</option>
              </Select>
              {value.end === 'until' && (
                <Input
                  type="date"
                  aria-label={t('knowledge.meeting.repeat.untilLabel')}
                  value={value.until}
                  min={date}
                  aria-invalid={!!error || undefined}
                  onChange={(event) => set({ until: event.target.value })}
                  className="min-w-0 flex-[2] px-3"
                />
              )}
              {value.end === 'count' && (
                <Input
                  type="number"
                  inputMode="numeric"
                  min={MEETING_SERIES_LIMITS.minCount}
                  max={MEETING_SERIES_LIMITS.maxCount}
                  aria-label={t('knowledge.meeting.repeat.countLabel')}
                  value={value.count}
                  aria-invalid={!!error || undefined}
                  onChange={(event) => set({ count: event.target.value })}
                  className="min-w-0 flex-[2] px-3"
                />
              )}
            </div>
          </fieldset>
          {error ? (
            <p className="text-tiny text-error-ink">{error}</p>
          ) : (
            <p className="text-tiny text-muted-foreground">{t('knowledge.meeting.repeat.hint')}</p>
          )}
        </>
      )}
    </div>
  );
}

/** The detail's series line: the rule, and how the series ends. */
export function MeetingSeriesLine({
  series,
  startsAt,
}: {
  series: MeetingSeriesInfo;
  startsAt: string;
}) {
  const { t, i18n } = useTranslation();
  const rule = ruleLabel(t, i18n.language, series.frequency, new Date(startsAt), series.timeZone);
  const until =
    series.until &&
    new Intl.DateTimeFormat(locale(i18n.language), { dateStyle: 'long' }).format(
      new Date(`${series.until}T12:00:00Z`),
    );
  const end = until
    ? t('knowledge.meeting.series.until', { date: until })
    : series.count !== null
      ? t('knowledge.meeting.series.count', { count: series.count })
      : series.ended
        ? t('knowledge.meeting.series.ended')
        : null;
  return (
    <p
      className="flex items-start gap-2 text-button text-muted-foreground"
      data-testid="meeting-series"
    >
      <RepeatIcon className="mt-0.5 shrink-0" />
      <span>
        {t('knowledge.meeting.series.repeats', { rule })}
        {end && <> {end}</>}
      </span>
    </p>
  );
}
