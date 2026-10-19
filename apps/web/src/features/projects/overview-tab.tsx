import { lazy, Suspense, type ReactNode } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { withNamespaces } from '@/i18n/namespaces';
import { NotFoundPage } from '@/routes/not-found';
import { ActiveCards } from './active-cards';
import { ProjectsCard } from './projects-card';
import { Timeline } from './timeline';
import { useProjectEvents } from './use-project-events';
import { useWorkEvents } from './use-work-events';
import { useMarkOpened } from '@/lib/use-mark-opened';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';

// The task panel and its texts load only when a task is opened (`?task=<id>`).
const loadPanel = withNamespaces(
  ['tasks', 'chat', 'taskSplit', 'forms', 'reminders'],
  () => import('./overview-task-panel'),
);
const OverviewTaskPanel = lazy(() =>
  loadPanel().then((module) => ({ default: module.OverviewTaskPanel })),
);
// 2026-10-19: the weekly summary line, admins only, with its own texts.
const WeeklySummaryOverviewLine = lazy(() =>
  withNamespaces(['weeklySummary'], () => import('@/features/weekly-summary/overview-line'))().then(
    (m) => ({ default: m.WeeklySummaryOverviewLine }),
  ),
);
// F15: an event reminder's notification opens the event sheet (`?event=<id>`).
const EventSheet = lazy(() => import('./event-sheet').then((m) => ({ default: m.EventSheet })));

/** Today as the browser sees it, `YYYY-MM-DD` (the sheet's overdue marks). */
const localToday = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * A client's Prehľad tab (`/groups/$groupId/overview`, Phase 33, spec §7.1), for everyone who
 * reads the group (a žiadateľ never reaches a group): the timeline (part P4), the active tickets
 * and tasks cards (P4) and the projects card (P1). `?project=` picks the timeline's project,
 * `?task=` opens the task panel over the tab, `?event=` one event's sheet (F15).
 */
export function OverviewTab() {
  const { groupId } = useParams({ strict: false });
  if (!groupId) return <NotFoundPage />;
  return <Overview groupId={groupId} />;
}

function Overview({ groupId }: { groupId: string }) {
  const admin = isAdmin(useSession());
  useProjectEvents(groupId);
  useWorkEvents(groupId);
  // The timeline's project (`?project=`) is remembered per group, like the boards' filters.
  const search = useRememberedFilters(
    `overview.${groupId}`,
    ['project'],
    useSearch({ strict: false }) as { project?: string; task?: string; event?: string },
  );
  // The timeline on one project is where its notifications (and the Mentions card) open it: a
  // mention in its description is read (2026-10-18).
  useMarkOpened('project', search.project ?? null);
  const navigate = useNavigate();
  const closeEvent = () =>
    void navigate({
      to: '/groups/$groupId/overview',
      params: { groupId },
      replace: true,
      search: ((prev: Record<string, unknown>) => ({ ...prev, event: undefined })) as never,
    });
  return (
    <>
      {admin && (
        <Suspense fallback={null}>
          <WeeklySummaryOverviewLine groupId={groupId} />
        </Suspense>
      )}
      <OverviewGrid
        timeline={<Timeline groupId={groupId} project={search.project ?? null} />}
        active={<ActiveCards groupId={groupId} />}
        projects={<ProjectsCard groupId={groupId} />}
      />
      {search.task && (
        <Suspense fallback={null}>
          <OverviewTaskPanel groupId={groupId} taskId={search.task} />
        </Suspense>
      )}
      {search.event && !search.task && (
        <Suspense fallback={null}>
          <EventSheet
            groupId={groupId}
            eventId={search.event}
            doneCount={0}
            today={localToday()}
            onClose={closeEvent}
          />
        </Suspense>
      )}
    </>
  );
}

/**
 * The page's rows (spec §7.1): the timeline across the page width, the two active cards side by
 * side from 641 px, then the projects card. An empty slot takes no space.
 */
export function OverviewGrid({
  timeline,
  active,
  projects,
}: {
  timeline: ReactNode;
  active: ReactNode;
  projects: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-6">
      <h2 className="sr-only">{t('projects.overview.title')}</h2>
      {timeline}
      {active && <div className="grid gap-4 min-[641px]:grid-cols-2">{active}</div>}
      {projects}
    </div>
  );
}
