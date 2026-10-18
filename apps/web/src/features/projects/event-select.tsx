import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { EventPickerItem, EventRefDto } from '@spolu/shared';
import { Select } from '@/components/ui/select';
import { eventPickerQuery } from './api';
import { formatEventDate } from './project-dot';

/** Today in Bratislava, `YYYY-MM-DD` (spec §2: an event is past, today or coming by it). */
export function bratislavaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(now);
}

/** Coming events (today included) first by date, then the past ones, latest first. */
export function orderEvents(events: readonly EventPickerItem[], today: string): EventPickerItem[] {
  const coming = events.filter((e) => e.occursOn >= today);
  const past = events.filter((e) => e.occursOn < today);
  const byDate = (a: EventPickerItem, b: EventPickerItem) => a.occursOn.localeCompare(b.occursOn);
  return [...coming.sort(byDate), ...past.sort((a, b) => byDate(b, a))];
}

/**
 * The Event select under the Project select (Phase 33 part P2, spec §6): "No event", then the
 * project's events, coming ones first. Loads when it mounts, like `ProjectSelect`; the
 * caller renders it only with a project chosen and clears the event when the project changes.
 */
export function EventSelect({
  id,
  groupId,
  projectId,
  value,
  current,
  onChange,
  labels,
  disabled,
  className,
}: {
  id?: string;
  groupId: string;
  projectId: string;
  value: string | null;
  current?: EventRefDto | null;
  onChange: (eventId: string | null) => void;
  labels: { label: string; none: string };
  disabled?: boolean;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const picker = useQuery(eventPickerQuery(groupId, projectId));
  const events = orderEvents(picker.data ?? [], bratislavaToday());
  const known = events.some((e) => e.id === value);
  const fallback = value !== null && !known && current?.id === value ? current : null;
  const text = (e: { name: string; occursOn: string }) =>
    `${e.name} (${formatEventDate(e.occursOn, i18n.language)})`;

  return (
    <Select
      id={id}
      aria-label={id ? undefined : labels.label}
      aria-busy={picker.isFetching || undefined}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      containerClassName={className ?? 'w-full'}
    >
      <option value="">{labels.none}</option>
      {fallback && <option value={fallback.id}>{text(fallback)}</option>}
      {value !== null && !known && !fallback && <option value={value}>…</option>}
      {events.map((e) => (
        <option key={e.id} value={e.id}>
          {text(e)}
        </option>
      ))}
    </Select>
  );
}
