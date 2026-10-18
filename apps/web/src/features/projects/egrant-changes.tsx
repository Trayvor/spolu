import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorCodes, type EgrantChangeDto, type EventPickerItem } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { PanelNotice } from '@/components/ui/panel-notice';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { egrantChangesQuery, projectsKey, reviewEgrantChanges } from './api';
import { formatEventDate } from './project-dot';

type Choice = 'accept' | 'dismiss';
type IncomingEvent = { name: string; occursOn: string; description: string };

const isEvent = (v: EgrantChangeDto['current']): v is IncomingEvent =>
  typeof v === 'object' && v !== null;

/**
 * "Changes from eGrant (n)" in the project sheet (Phase 33 part P3, decision 6d): one row per
 * field with the current and the incoming value, Accept or Dismiss on each; rows left alone stay
 * pending; "Save choices" applies them in one save. Accepting a removal asks first (the event's
 * tasks and tickets keep the project, without the event). An addition next to a removal shows
 * "Maybe the same event".
 */
export function EgrantChanges({
  groupId,
  projectId,
  events,
}: {
  groupId: string;
  projectId: string;
  events: EventPickerItem[];
}) {
  const { t, i18n } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`projects.egrant.${key}`, options);
  const client = useQueryClient();
  const query = useQuery(egrantChangesQuery(groupId, projectId));
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = query.data;
  if (!list || list.changes.length === 0) return null;

  const date = (iso: string) => formatEventDate(iso, i18n.language);
  const eventName = (id: string | null) => events.find((e) => e.id === id)?.name ?? '';
  const byId = new Map(list.changes.map((c) => [c.id, c]));
  const pairOf = (c: EgrantChangeDto) => {
    const pair = list.maybeSame.find((p) => p.addId === c.id || p.removeId === c.id);
    if (!pair) return null;
    const other = byId.get(pair.addId === c.id ? pair.removeId : pair.addId);
    const value = other && (other.kind === 'event_add' ? other.incoming : other.current);
    return isEvent(value ?? null) ? (value as IncomingEvent) : null;
  };
  const chosen = Object.entries(choices);
  const removals = chosen.filter(
    ([id, choice]) => choice === 'accept' && byId.get(id)?.kind === 'event_remove',
  ).length;

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await reviewEgrantChanges(projectId, {
        accept: chosen.filter(([, c]) => c === 'accept').map(([id]) => id),
        dismiss: chosen.filter(([, c]) => c === 'dismiss').map(([id]) => id),
      });
      setChoices({});
      setConfirming(false);
    } catch (e) {
      setConfirming(false);
      setError(
        e instanceof ApiError && e.code === ErrorCodes.changeOutdated
          ? k('outdated')
          : e instanceof ApiError && e.code === ErrorCodes.projectNameTaken
            ? k('nameTaken')
            : k('failed'),
      );
      setChoices({});
    } finally {
      setSaving(false);
      void client.invalidateQueries({ queryKey: projectsKey(groupId) });
    }
  };

  const label = (c: EgrantChangeDto) => {
    switch (c.kind) {
      case 'project_name':
        return k('kinds.projectName');
      case 'project_description':
        return k('kinds.projectDescription');
      case 'event_name':
        return k('kinds.eventName', { event: eventName(c.eventId) });
      case 'event_date':
        return k('kinds.eventDate', { event: eventName(c.eventId) });
      case 'event_description':
        return k('kinds.eventDescription', { event: eventName(c.eventId) });
      case 'event_add':
        return k('kinds.eventAdd');
      case 'event_remove':
        return k('kinds.eventRemove');
    }
  };
  const show = (c: EgrantChangeDto, value: EgrantChangeDto['current']) => {
    if (value === null) return null;
    if (isEvent(value)) return `${value.name}, ${date(value.occursOn)}`;
    if (c.kind === 'event_date') return date(value);
    return value === '' ? k('empty') : value;
  };

  return (
    <section
      id="egrant-changes"
      aria-labelledby="egrant-changes-title"
      className="flex flex-col gap-3 rounded-xl border-2 border-border p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 id="egrant-changes-title" className="text-button font-semibold">
          {k('title', { count: list.changes.length })}
        </h3>
        <p className="text-tiny text-muted-foreground">{k('hint')}</p>
      </div>
      <ul className="flex flex-col divide-y-2 divide-border">
        {list.changes.map((c) => {
          const current = show(c, c.current);
          const incoming = show(c, c.incoming);
          const long = c.kind === 'project_description' || c.kind === 'event_description';
          const pair = pairOf(c);
          const choice = choices[c.id];
          const pick = (next: Choice) =>
            setChoices((all) => {
              const copy = { ...all };
              if (copy[c.id] === next) delete copy[c.id];
              else copy[c.id] = next;
              return copy;
            });
          return (
            <li key={c.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <p className="text-tiny font-semibold">{label(c)}</p>
              <div className={cn('flex gap-2 text-button', long ? 'flex-col' : 'flex-wrap')}>
                {current !== null && (
                  <span className={cn('break-words', long && 'whitespace-pre-line')}>
                    <span className="sr-only">{k('current')} </span>
                    <span className={cn(incoming !== null && 'text-muted-foreground line-through')}>
                      {current}
                    </span>
                  </span>
                )}
                {current !== null && incoming !== null && (
                  <span aria-hidden="true" className="text-muted-foreground">
                    {long ? '↓' : '→'}
                  </span>
                )}
                {incoming !== null && (
                  <span className={cn('font-semibold break-words', long && 'whitespace-pre-line')}>
                    <span className="sr-only">{k('incoming')} </span>
                    {incoming}
                  </span>
                )}
              </div>
              {pair && (
                <p className="text-tiny text-muted-foreground">
                  {k('maybeSame', { name: pair.name, date: date(pair.occursOn) })}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={choice === 'accept' ? 'default' : 'outline'}
                  aria-pressed={choice === 'accept'}
                  onClick={() => pick('accept')}
                >
                  {k('accept')}
                </Button>
                <Button
                  size="sm"
                  variant={choice === 'dismiss' ? 'default' : 'outline'}
                  aria-pressed={choice === 'dismiss'}
                  onClick={() => pick('dismiss')}
                >
                  {k('dismiss')}
                </Button>
                <span className="text-micro text-muted-foreground">
                  {k('received', {
                    date: new Date(c.receivedAt).toLocaleString(i18n.language, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }),
                  })}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-button text-error-ink">
          {error}
        </p>
      )}
      {confirming ? (
        <PanelNotice text={k('confirmRemove', { count: removals })}>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {k('cancel')}
          </Button>
          <Button variant="destructive" disabled={saving} onClick={() => void save()}>
            {k('save')}
          </Button>
        </PanelNotice>
      ) : (
        <Button
          className="self-start"
          disabled={chosen.length === 0 || saving}
          onClick={() => (removals > 0 ? setConfirming(true) : void save())}
        >
          {k('save')}
        </Button>
      )}
    </section>
  );
}

/** The ids of the events that have pending eGrant changes (the sheet's marks). */
export function useEventsWithChanges(groupId: string, projectId: string, enabled: boolean) {
  const query = useQuery({ ...egrantChangesQuery(groupId, projectId), enabled });
  return new Set(
    (query.data?.changes ?? []).flatMap((c) => (c.eventId === null ? [] : [c.eventId])),
  );
}
