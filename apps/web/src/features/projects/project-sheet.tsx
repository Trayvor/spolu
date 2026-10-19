import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { FileInfo, ProjectDto } from '@spolu/shared';
import { MoreIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PanelHeader } from '@/components/ui/panel-header';
import { PanelNotice } from '@/components/ui/panel-notice';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DescriptionView } from '@/features/editor/description-field';
import { FileChip } from '@/features/files/file-chip';
import { ImagePreview } from '@/features/files/image-preview';
import { useGroupPeople } from '@/features/groups/use-group-people';
import { useMarkOpened } from '@/lib/use-mark-opened';
import { AuditHistoryItem } from '@/features/audit/history-item';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import {
  deleteProject,
  eventPickerQuery,
  eventQuery,
  projectQuery,
  projectsKey,
  setProjectArchived,
} from './api';
import { EgrantChanges, useEventsWithChanges } from './egrant-changes';
import { EventDialog } from './event-dialog';
import { MergePanel } from './merge-panel';
import { ProjectDialog } from './project-dialog';
import { formatEventDate, ProjectDot } from './project-dot';

type Layer =
  | { kind: 'edit' }
  | { kind: 'newEvent' }
  | { kind: 'event'; id: string }
  | { kind: 'delete' }
  | { kind: 'merge' }
  | null;

/** A project's or an event's files: images as previews, the rest as chips. */
export function Files({ files }: { files: FileInfo[] }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {files.map((file) =>
        file.mime.startsWith('image/') ? (
          <ImagePreview
            key={file.id}
            file={file}
            maxWidth={
              file.width && file.height ? Math.min(320, (240 * file.width) / file.height) : 320
            }
          />
        ) : (
          <FileChip key={file.id} file={file} />
        ),
      )}
    </div>
  );
}

/**
 * One project in a `SheetDialog` (spec §7.5): its description, files and events by date, with
 * "+ Event". Edit, Archive or Restore and Delete in its menu, for everyone who reads the group
 * (decisions 8 and 8a). Part P3 adds "Merge into…" and the eGrant changes; "Show on the
 * timeline" (part P4) selects it in the timeline.
 */
export function ProjectSheet({
  groupId,
  projectId,
  onClose,
}: {
  groupId: string;
  projectId: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const admin = isAdmin(useSession());
  const client = useQueryClient();
  const query = useQuery(projectQuery(groupId, projectId));
  const events = useQuery(eventPickerQuery(groupId, projectId));
  const people = useGroupPeople(groupId).data;
  const project = query.data;
  // Opened: a mention in its description is read on the Mentions card (2026-10-18).
  useMarkOpened('project', project?.id ?? null);
  const [layer, setLayer] = useState<Layer>(null);
  const [error, setError] = useState<string | null>(null);
  const k = (key: string, options?: Record<string, unknown>) => t(`projects.sheet.${key}`, options);

  const refresh = () => client.invalidateQueries({ queryKey: projectsKey(groupId) });
  const run = async (action: () => Promise<unknown>, closeAfter = false) => {
    setError(null);
    try {
      await action();
      void refresh();
      if (closeAfter) onClose();
    } catch {
      setError(k('failed'));
    }
  };
  const nameOf = (id: string) => people?.find((p) => p.id === id)?.name;
  // Part P4: selects the project in the timeline (`?project=`); a link in a layer replaces.
  const navigate = useNavigate();
  const showOnTimeline = (id: string) => {
    void navigate({
      to: '/groups/$groupId/overview',
      params: { groupId },
      search: (prev: Record<string, unknown>) => ({ ...prev, project: id, sheet: undefined }),
      replace: true,
    });
    onClose();
  };
  const changedEvents = useEventsWithChanges(groupId, projectId, (project?.egrantChanges ?? 0) > 0);

  return (
    <SheetDialog onEscape={() => (layer ? setLayer(null) : onClose())} testId="project-sheet">
      <PanelHeader onClose={onClose} compactBelow={641} backLabel={k('back')}>
        {project && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={k('actions')}>
                <MoreIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {admin && (
                <AuditHistoryItem
                  entityType="project"
                  entityId={project.id}
                  label={project.name}
                  text={t('projects.menu.history')}
                />
              )}
              <DropdownMenuItem onSelect={() => setLayer({ kind: 'edit' })}>
                {k('edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => showOnTimeline(project.id)}>
                {t('projects.timeline.showOnTimeline')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  void run(() => setProjectArchived(project.id, project.status === 'active'))
                }
              >
                {project.status === 'active' ? k('archive') : k('restore')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLayer({ kind: 'merge' })}>
                {t('projects.merge.action')}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-error-ink"
                onSelect={() => setLayer({ kind: 'delete' })}
              >
                {k('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 min-[641px]:px-6 min-[641px]:py-5">
        {!project ? (
          query.isError ? (
            <p role="alert" className="text-button text-error-ink">
              {k('unavailable')}
            </p>
          ) : (
            <div aria-busy="true" className="flex flex-col gap-3">
              <Skeleton className="h-7 w-2/3 bg-secondary" />
              <Skeleton className="h-20 bg-secondary" />
            </div>
          )
        ) : (
          <>
            {layer?.kind === 'delete' && (
              <PanelNotice text={deleteText(project, k)}>
                <Button variant="ghost" onClick={() => setLayer(null)}>
                  {k('cancel')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void run(() => deleteProject(project.id), true)}
                >
                  {k('delete')}
                </Button>
              </PanelNotice>
            )}
            {layer?.kind === 'merge' && (
              <MergePanel
                groupId={groupId}
                project={project}
                onCancel={() => setLayer(null)}
                onMerged={() => {
                  void refresh();
                  onClose();
                }}
              />
            )}
            {error && (
              <p role="alert" className="text-button text-error-ink">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <ProjectDot color={project.color} className="size-3" />
                <SheetDialogTitle className="min-w-0 break-words text-medium font-semibold">
                  {project.name}
                </SheetDialogTitle>
              </div>
              <div className="flex flex-wrap gap-2">
                {project.status === 'archived' && (
                  <Badge variant="secondary">{k('archived')}</Badge>
                )}
                {project.source === 'egrant' && (
                  <Badge variant="secondary">{t('projects.fromEgrant')}</Badge>
                )}
                {project.egrantChanges > 0 && (
                  <Badge asChild variant="outline">
                    <a href="#egrant-changes">
                      {t('projects.egrantChanges', { count: project.egrantChanges })}
                    </a>
                  </Badge>
                )}
              </div>
            </div>
            <DescriptionView
              body={project.description}
              groupId={project.groupId}
              linked={project.linkedKnowledge}
              subject={{ kind: 'project', id: project.id }}
              nameOf={nameOf}
              className="text-button"
            />
            {project.files.length > 0 && <Files files={project.files} />}
            {project.egrantChanges > 0 && (
              <EgrantChanges groupId={groupId} projectId={project.id} events={events.data ?? []} />
            )}

            <section aria-labelledby="project-events-title" className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <h3 id="project-events-title" className="mr-auto text-button font-semibold">
                  {k('events')}
                </h3>
                <Button size="sm" variant="outline" onClick={() => setLayer({ kind: 'newEvent' })}>
                  {k('addEvent')}
                </Button>
              </div>
              {events.data && events.data.length === 0 && (
                <p className="text-button text-muted-foreground">{k('noEvents')}</p>
              )}
              <ol role="list" className="-mx-2 flex flex-col">
                {events.data?.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => setLayer({ kind: 'event', id: event.id })}
                      className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted"
                    >
                      <time
                        dateTime={event.occursOn}
                        className="w-24 shrink-0 text-tiny text-muted-foreground tabular-nums"
                      >
                        {formatEventDate(event.occursOn, i18n.language)}
                      </time>
                      <span className="min-w-0 flex-1 text-button font-semibold">{event.name}</span>
                      {event.source === 'egrant' && (
                        <Badge variant="secondary">{t('projects.fromEgrant')}</Badge>
                      )}
                      {changedEvents.has(event.id) && (
                        <Badge variant="outline">{t('projects.egrant.eventMark')}</Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
      {project && layer?.kind === 'edit' && (
        <ProjectDialog groupId={groupId} project={project} onClose={() => setLayer(null)} />
      )}
      {project && layer?.kind === 'newEvent' && (
        <EventDialog groupId={groupId} project={project} onClose={() => setLayer(null)} />
      )}
      {project && layer?.kind === 'event' && (
        <EditEvent
          groupId={groupId}
          project={project}
          eventId={layer.id}
          onClose={() => setLayer(null)}
        />
      )}
    </SheetDialog>
  );
}

/** "Delete X? Its n events go too; its tasks and tickets stay, without the project." */
function deleteText(
  project: ProjectDto,
  k: (key: string, options?: Record<string, unknown>) => string,
): string {
  return [
    k('deleteConfirm', { name: project.name }),
    project.eventCount > 0 ? k('deleteEvents', { count: project.eventCount }) : null,
    project.openTasks + project.openTickets > 0
      ? k('deleteKeeps', { tasks: project.openTasks, tickets: project.openTickets })
      : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Loads an event, then opens it in the event dialog. */
function EditEvent({
  groupId,
  project,
  eventId,
  onClose,
}: {
  groupId: string;
  project: ProjectDto;
  eventId: string;
  onClose: () => void;
}) {
  const event = useQuery(eventQuery(groupId, eventId)).data;
  if (!event) return null;
  return <EventDialog groupId={groupId} project={project} event={event} onClose={onClose} />;
}
