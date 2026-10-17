import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ProjectListItem, ProjectStatus } from '@spolu/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SegmentedControl } from '@/features/finance/segmented-control';
import { projectsPageQuery } from './api';
import { ProjectDialog } from './project-dialog';
import { formatEventDate, ProjectDot } from './project-dot';
import { ProjectSheet } from './project-sheet';

/**
 * The projects card of the Prehľad tab (spec §7.5): the client's projects by name, 30 a page,
 * active ones or the archived ones. A row opens the project sheet; "New project" the dialog.
 * Everyone who reads the group may create, edit, archive and delete (decisions 8 and 8a); the
 * server decides anyway.
 */
export function ProjectsCard({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useInfiniteQuery(projectsPageQuery(groupId, status));
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const k = (key: string) => t(`projects.card.${key}`);

  return (
    <section aria-labelledby="projects-card-title" className="flex flex-col rounded-xl bg-card">
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-3">
        <h2 id="projects-card-title" className="mr-auto text-medium leading-tight font-semibold">
          {k('title')}
        </h2>
        <SegmentedControl
          label={k('show')}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: k('active') },
            { value: 'archived', label: k('archived') },
          ]}
          className="w-56"
        />
        <Button size="sm" onClick={() => setCreating(true)}>
          {k('new')}
        </Button>
      </div>
      <div className="px-5 pb-5">
        {query.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg bg-secondary" />
            ))}
          </div>
        ) : query.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 py-4">
            <p className="text-button text-error-ink">{k('loadError')}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              {k('retry')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="mx-auto max-w-[52ch] py-8 text-center text-button text-muted-foreground">
            {status === 'active' ? k('empty') : k('emptyArchived')}
          </p>
        ) : (
          <>
            <ul className="-mx-2 flex flex-col">
              {items.map((project) => (
                <li key={project.id}>
                  <ProjectRow project={project} onOpen={() => setOpenId(project.id)} />
                </li>
              ))}
            </ul>
            {query.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {k('more')}
              </Button>
            )}
          </>
        )}
      </div>
      {creating && (
        <ProjectDialog
          groupId={groupId}
          onClose={(created) => {
            setCreating(false);
            if (created) setOpenId(created.id);
          }}
        />
      )}
      {openId && (
        <ProjectSheet groupId={groupId} projectId={openId} onClose={() => setOpenId(null)} />
      )}
    </section>
  );
}

/** One project: its dot, name and badges, then its events and open work. */
function ProjectRow({ project, onOpen }: { project: ProjectListItem; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`projects.card.${key}`, options);
  const facts = [
    k('events', { count: project.eventCount }),
    project.nextEvent &&
      k('next', {
        name: project.nextEvent.name,
        date: formatEventDate(project.nextEvent.occursOn, i18n.language),
      }),
    project.openTasks > 0 && k('openTasks', { count: project.openTasks }),
    project.openTickets > 0 && k('openTickets', { count: project.openTickets }),
  ].filter((fact): fact is string => typeof fact === 'string');
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-1 rounded-lg px-2 py-2.5 text-left hover:bg-muted focus-visible:bg-muted"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <ProjectDot color={project.color} />
        <span className="min-w-0 truncate text-button font-semibold">{project.name}</span>
        {project.source === 'egrant' && (
          <Badge variant="secondary">{t('projects.fromEgrant')}</Badge>
        )}
        {project.egrantChanges > 0 && (
          <Badge variant="outline">
            {t('projects.egrantChanges', { count: project.egrantChanges })}
          </Badge>
        )}
      </span>
      <span className="flex flex-wrap gap-x-4 gap-y-0.5 pl-[18px] text-tiny text-muted-foreground">
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </span>
    </button>
  );
}
