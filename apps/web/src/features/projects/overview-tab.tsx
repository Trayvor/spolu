import type { ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { NotFoundPage } from '@/routes/not-found';
import { ProjectsCard } from './projects-card';
import { useProjectEvents } from './use-project-events';

/**
 * A client's Prehľad tab (`/groups/$groupId/overview`, Phase 33, spec §7.1), for everyone who
 * reads the group (a žiadateľ never reaches a group). Part P4 fills the `timeline` and `active`
 * slots with its own components; part P1 renders the projects card.
 */
export function OverviewTab() {
  const { groupId } = useParams({ strict: false });
  if (!groupId) return <NotFoundPage />;
  return <Overview groupId={groupId} />;
}

function Overview({ groupId }: { groupId: string }) {
  useProjectEvents(groupId);
  return (
    <OverviewGrid
      // Part P4: <Timeline groupId={groupId} />
      timeline={null}
      // Part P4: <ActiveCards groupId={groupId} />
      active={null}
      projects={<ProjectsCard groupId={groupId} />}
    />
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
    <div className="flex flex-col gap-4 pb-6">
      <h1 className="sr-only">{t('projects.overview.title')}</h1>
      {timeline}
      {active && <div className="grid gap-4 min-[641px]:grid-cols-2">{active}</div>}
      {projects}
    </div>
  );
}
