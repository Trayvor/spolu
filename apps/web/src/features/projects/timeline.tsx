import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ProjectPickerItem, TimelineEventDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { projectPickerQuery } from './api';
import { EventDialog } from './event-dialog';
import { formatEventDate } from './project-dot';
import { ProjectDialog } from './project-dialog';
import { timelinePageQuery, type TimelinePageParam } from './timeline-api';
import { TimelineEvent } from './timeline-event';
import { daysBetween, gapOf, mergeEvents, todayIndex, whenOf } from './timeline-model';

// The event sheet loads on its first open.
const EventSheet = lazy(() => import('./event-sheet').then((m) => ({ default: m.EventSheet })));

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The timeline card of the Prehľad tab (spec §7.2, decisions 14–17): the client's events as one
 * straight line of equal columns, Today marked between the last past and the first coming one,
 * all active projects or one chosen project (`?project=`, its whole life). It opens scrolled so
 * Today sits a third from the left; "Earlier" and "Later" load 15 more events each way and keep
 * what is on screen in place. Each page is its own query, so a change refetches every loaded
 * page with its own cursor.
 */
export function Timeline({ groupId, project }: { groupId: string; project: string | null }) {
  // A new selection starts again around today.
  return <TimelineCard key={project ?? 'all'} groupId={groupId} project={project} />;
}

type Layer =
  | { kind: 'event'; id: string; doneCount: number }
  | { kind: 'newEvent'; project: { id: string; name: string } }
  | { kind: 'newProject' }
  | null;

function TimelineCard({ groupId, project }: { groupId: string; project: string | null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`projects.timeline.${key}`, options);
  const picker = useQuery(projectPickerQuery(groupId));
  const [params, setParams] = useState<TimelinePageParam[]>([{}]);
  const pages = useQueries({
    queries: params.map((param) => timelinePageQuery(groupId, project, param)),
  });
  const [layer, setLayer] = useState<Layer>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  /** Set by "Earlier": the distance from the strip's right end to keep once the page arrives. */
  const keepRight = useRef<number | null>(null);
  const scrolledToToday = useRef(false);

  const firstPage = pages[0]?.data;
  const lastPage = pages[pages.length - 1]?.data;
  const center = pages[params.findIndex((p) => !p.before && !p.after)];
  const today = center?.data?.today ?? firstPage?.today ?? '';
  const events = mergeEvents(pages.map((page) => page.data?.events));
  const marker = todayIndex(events, today);
  const chosen = picker.data?.find((p) => p.id === project) ?? null;
  const active = picker.data?.filter((p) => p.status === 'active') ?? [];
  const archived = picker.data?.filter((p) => p.status === 'archived') ?? [];

  const scrollToToday = useCallback((smooth: boolean) => {
    const strip = scroller.current;
    const mark = strip?.querySelector<HTMLElement>('[data-today]');
    if (!strip || !mark) return;
    const left = Math.max(0, mark.offsetLeft - strip.clientWidth / 3);
    if (typeof strip.scrollTo === 'function') {
      strip.scrollTo({ left, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
    } else strip.scrollLeft = left;
  }, []);

  // Opens with Today a third from the left, once.
  useLayoutEffect(() => {
    if (scrolledToToday.current || !center?.data) return;
    scrolledToToday.current = true;
    scrollToToday(false);
  }, [center?.data, scrollToToday]);

  // "Earlier" prepended a page: what was on screen stays where it was.
  useLayoutEffect(() => {
    const strip = scroller.current;
    if (!strip || keepRight.current === null || !pages[0]?.data) return;
    strip.scrollLeft = strip.scrollWidth - keepRight.current;
    keepRight.current = null;
  }, [pages, events.length]);

  // "Show on the timeline" from the project sheet brings the card into view.
  useEffect(() => {
    if (project && typeof card.current?.scrollIntoView === 'function') {
      card.current.scrollIntoView({ block: 'nearest' });
    }
  }, [project]);

  const earlier = () => {
    if (!firstPage?.before) return;
    const strip = scroller.current;
    keepRight.current = strip ? strip.scrollWidth - strip.scrollLeft : null;
    setParams((list) => [{ before: firstPage.before! }, ...list]);
  };
  const later = () => {
    if (!lastPage?.after) return;
    setParams((list) => [...list, { after: lastPage.after! }]);
  };
  const choose = (value: string) =>
    void navigate({
      to: '/groups/$groupId/overview',
      params: { groupId },
      search: (prev: Record<string, unknown>) => ({ ...prev, project: value || undefined }),
      replace: true,
    });

  /** Arrow keys move between the events; the strip follows the focus. */
  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('li[data-event] h3 button'),
    ];
    const current = buttons.findIndex((b) => b === document.activeElement);
    if (current === -1) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : Math.min(
              buttons.length - 1,
              Math.max(0, current + (event.key === 'ArrowLeft' ? -1 : 1)),
            );
    buttons[next]?.focus();
    buttons[next]?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  };

  const addEvent = (target: { id: string; name: string }) =>
    setLayer({ kind: 'newEvent', project: target });

  const pending = !center?.data && !center?.isError;
  const noProjects = picker.data !== undefined && picker.data.length === 0;

  return (
    <section
      ref={card}
      aria-labelledby="timeline-title"
      className="flex min-w-0 flex-col rounded-xl bg-card"
    >
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-2">
        <h2 id="timeline-title" className="mr-auto text-medium leading-tight font-semibold">
          {k('title')}
        </h2>
        {!noProjects && (
          <>
            <ProjectSelect
              label={k('projectSelect')}
              value={project ?? ''}
              active={active}
              archived={archived}
              onChange={choose}
            />
            <Button variant="outline" size="sm" onClick={() => scrollToToday(true)}>
              {k('todayButton')}
            </Button>
            {chosen ? (
              <Button size="sm" onClick={() => addEvent(chosen)}>
                {k('addEvent')}
              </Button>
            ) : (
              active.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm">{k('addEvent')}</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {active.map((p) => (
                      <DropdownMenuItem key={p.id} onSelect={() => addEvent(p)}>
                        {k('addEventTo', { name: p.name })}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            )}
          </>
        )}
      </div>

      {noProjects ? (
        <div className="flex flex-col items-center gap-3 px-5 pt-4 pb-8 text-center">
          <p className="max-w-[52ch] text-button text-muted-foreground">{k('noProjects')}</p>
          <Button size="sm" onClick={() => setLayer({ kind: 'newProject' })}>
            {t('projects.card.new')}
          </Button>
        </div>
      ) : pending ? (
        <div aria-busy="true" className="flex gap-4 overflow-hidden px-5 pb-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-[184px] shrink-0 rounded-lg bg-secondary" />
          ))}
        </div>
      ) : center?.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 px-5 pb-5">
          <p className="text-button text-error-ink">{k('loadError')}</p>
          <Button variant="outline" size="sm" onClick={() => void center.refetch()}>
            {t('projects.card.retry')}
          </Button>
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 pt-4 pb-8 text-center">
          <p className="text-button text-muted-foreground">{k('noEvents')}</p>
          {chosen && (
            <Button size="sm" variant="outline" onClick={() => addEvent(chosen)}>
              {k('addEvent')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-1 pb-3">
          <EdgeButton
            label={k('earlier')}
            side="left"
            visible={Boolean(firstPage?.before)}
            busy={pages[0]?.isFetching ?? false}
            onClick={earlier}
          />
          <div
            ref={scroller}
            data-testid="timeline-strip"
            className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain pb-2 [scrollbar-width:thin]"
          >
            <ol
              aria-label={k('listLabel')}
              onKeyDown={onKeyDown}
              className="flex w-max items-start"
            >
              {events.map((event, index) => (
                <EventSlot
                  key={event.id}
                  index={index}
                  marker={marker}
                  events={events}
                  today={today}
                  groupId={groupId}
                  showProject={project === null}
                  onOpen={(e) => setLayer({ kind: 'event', id: e.id, doneCount: e.doneCount })}
                />
              ))}
              {marker === events.length && (
                <TodayMarker
                  label={k('todayAt', { date: formatEventDate(today, i18n.language) })}
                />
              )}
            </ol>
          </div>
          <EdgeButton
            label={k('later')}
            side="right"
            visible={Boolean(lastPage?.after)}
            busy={pages[pages.length - 1]?.isFetching ?? false}
            onClick={later}
          />
        </div>
      )}

      {layer?.kind === 'event' && (
        <Suspense fallback={null}>
          <EventSheet
            groupId={groupId}
            eventId={layer.id}
            doneCount={layer.doneCount}
            today={today}
            onClose={() => setLayer(null)}
          />
        </Suspense>
      )}
      {layer?.kind === 'newEvent' && (
        <EventDialog groupId={groupId} project={layer.project} onClose={() => setLayer(null)} />
      )}
      {layer?.kind === 'newProject' && (
        <ProjectDialog groupId={groupId} onClose={() => setLayer(null)} />
      )}
    </section>
  );
}

/** An event, with the Today marker before it when it is the first from today on. */
function EventSlot({
  index,
  marker,
  events,
  today,
  groupId,
  showProject,
  onOpen,
}: {
  index: number;
  marker: number;
  events: TimelineEventDto[];
  today: string;
  groupId: string;
  showProject: boolean;
  onOpen: (event: TimelineEventDto) => void;
}) {
  const { t, i18n } = useTranslation();
  const event = events[index]!;
  const previous = index > 0 ? events[index - 1] : undefined;
  const gap = previous ? gapOf(daysBetween(previous.occursOn, event.occursOn)) : null;
  return (
    <>
      {index === marker && (
        <TodayMarker
          label={t('projects.timeline.todayAt', { date: formatEventDate(today, i18n.language) })}
        />
      )}
      <TimelineEvent
        groupId={groupId}
        event={event}
        when={whenOf(event.occursOn, today)}
        gap={gap && t(`projects.timeline.gap.${gap.unit}`, { count: gap.count })}
        showProject={showProject}
        today={today}
        onOpen={() => onOpen(event)}
      />
    </>
  );
}

/** The vertical Today rule between the last past and the first coming event. */
function TodayMarker({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <li
      role="presentation"
      data-today=""
      className="relative flex w-12 shrink-0 justify-center self-stretch"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-4 h-0.5 -translate-y-1/2 bg-border"
      />
      <span aria-hidden="true" className="relative mt-0 h-full min-h-24 w-0.5 bg-foreground" />
      <span
        aria-hidden="true"
        className="absolute top-8 rounded-full bg-foreground px-2 py-0.5 text-micro font-semibold text-primary-foreground"
      >
        {t('projects.timeline.today')}
      </span>
      <span className="sr-only">{label}</span>
    </li>
  );
}

/** "Earlier" or "Later" at the strip's end; nothing when there is no more that way. */
function EdgeButton({
  label,
  side,
  visible,
  busy,
  onClick,
}: {
  label: string;
  side: 'left' | 'right';
  visible: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  if (!visible) return <span aria-hidden="true" className="w-2 shrink-0" />;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={onClick}
      className={side === 'left' ? 'mt-1 ml-2 shrink-0' : 'mt-1 mr-2 shrink-0'}
    >
      {label}
    </Button>
  );
}

/** All projects, each active project, and the archived ones in their own group. */
function ProjectSelect({
  label,
  value,
  active,
  archived,
  onChange,
}: {
  label: string;
  value: string;
  active: ProjectPickerItem[];
  archived: ProjectPickerItem[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="py-1.5 pl-3 text-tiny"
      containerClassName="max-w-56"
    >
      <option value="">{t('projects.timeline.allProjects')}</option>
      {active.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      {archived.length > 0 && (
        <optgroup label={t('projects.card.archived')}>
          {archived.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}
