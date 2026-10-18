import { lazy, Suspense, type ReactNode } from 'react';
import { useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { withNamespaces } from '@/i18n/namespaces';
import { NotFoundPage } from '@/routes/not-found';
import { ActiveCards } from './active-cards';
import { ProjectsCard } from './projects-card';
import { Timeline } from './timeline';
import { useProjectEvents } from './use-project-events';
import { useWorkEvents } from './use-work-events';
import { useRememberedFilters } from '@/lib/use-remembered-filters';

// The task panel and its texts load only when a task is opened (`?task=<id>`).
const loadPanel = withNamespaces(
  ['tasks', 'chat', 'taskSplit', 'forms', 'reminders'],
  () => import('./overview-task-panel'),
);
const OverviewTaskPanel = lazy(() =>
  loadPanel().then((module) => ({ default: module.OverviewTaskPanel })),
);

/**
 * A client's Prehľad tab (`/groups/$groupId/overview`, Phase 33, spec §7.1), for everyone who
 * reads the group (a žiadateľ never reaches a group): the timeline (part P4), the active tickets
 * and tasks cards (P4) and the projects card (P1). `?project=` picks the timeline's project,
 * `?task=` opens the task panel over the tab.
 */
export function OverviewTab() {
  const { groupId } = useParams({ strict: false });
  if (!groupId) return <NotFoundPage />;
  return <Overview groupId={groupId} />;
}

function Overview({ groupId }: { groupId: string }) {
  useProjectEvents(groupId);
  useWorkEvents(groupId);
  // The timeline's project (`?project=`) is remembered per group, like the boards' filters.
  const search = useRememberedFilters(
    `overview.${groupId}`,
    ['project'],
    useSearch({ strict: false }) as { project?: string; task?: string },
  );
  return (
    <>
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
      <h1 className="sr-only">{t('projects.overview.title')}</h1>
      {timeline}
      {active && <div className="grid gap-4 min-[641px]:grid-cols-2">{active}</div>}
      {projects}
    </div>
  );
}
