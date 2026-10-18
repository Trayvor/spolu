import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { EventItemsQuery } from '@spolu/shared';
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
import { useGroupPeople } from '@/features/groups/use-group-people';
import { deleteEvent, eventQuery, projectsKey } from './api';
import { DonePile } from './done-pile';
import { EventDialog } from './event-dialog';
import { RowsInLayer, TaskRow, TicketRow } from './event-rows';
import { Files } from './project-sheet';
import { formatEventDate, ProjectDot } from './project-dot';
import { eventItemsQuery } from './timeline-api';

/**
 * One event in a `SheetDialog` (spec §7.2, decision 17): its name, date, project, description,
 * files and attached knowledge, then every open task, every open ticket (20 a page) and the done
 * pile, expanded. Everyone who reads the group may edit and delete it (decision 8a). A task row
 * opens the task panel over the overview, a ticket row the ticket page.
 */
export function EventSheet({
  groupId,
  eventId,
  doneCount,
  today,
  onClose,
}: {
  groupId: string;
  eventId: string;
  doneCount: number;
  today: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const query = useQuery(eventQuery(groupId, eventId));
  const people = useGroupPeople(groupId).data;
  const event = query.data;
  const [layer, setLayer] = useState<'edit' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`projects.timeline.${key}`, options);

  const remove = async () => {
    setError(null);
    try {
      await deleteEvent(eventId);
      void client.invalidateQueries({ queryKey: projectsKey(groupId) });
      onClose();
    } catch {
      setError(t('projects.sheet.failed'));
    }
  };

  return (
    <SheetDialog onEscape={() => (layer ? setLayer(null) : onClose())} testId="event-sheet">
      <PanelHeader onClose={onClose} compactBelow={641} backLabel={t('projects.sheet.back')}>
        {event && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={k('eventActions')}>
                <MoreIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setLayer('edit')}>
                {t('projects.sheet.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-error-ink" onSelect={() => setLayer('delete')}>
                {t('projects.sheet.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PanelHeader>
      <RowsInLayer.Provider value={onClose}>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 min-[641px]:px-6 min-[641px]:py-5">
          {!event ? (
            query.isError ? (
              <p role="alert" className="text-button text-error-ink">
                {k('eventUnavailable')}
              </p>
            ) : (
              <div aria-busy="true" className="flex flex-col gap-3">
                <Skeleton className="h-7 w-2/3 bg-secondary" />
                <Skeleton className="h-20 bg-secondary" />
              </div>
            )
          ) : (
            <>
              {layer === 'delete' && (
                <PanelNotice text={t('projects.dialogs.deleteEventConfirm')}>
                  <Button variant="ghost" onClick={() => setLayer(null)}>
                    {t('projects.sheet.cancel')}
                  </Button>
                  <Button variant="destructive" onClick={() => void remove()}>
                    {t('projects.sheet.delete')}
                  </Button>
                </PanelNotice>
              )}
              {error && (
                <p role="alert" className="text-button text-error-ink">
                  {error}
                </p>
              )}
              <div className="flex flex-col gap-2">
                <SheetDialogTitle className="min-w-0 break-words text-medium font-semibold">
                  {event.name}
                </SheetDialogTitle>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-button text-muted-foreground">
                  <time dateTime={event.occursOn} className="tabular-nums">
                    {formatEventDate(event.occursOn, i18n.language)}
                  </time>
                  <span className="flex items-center gap-1.5">
                    <ProjectDot color={event.project.color ?? 'purple'} />
                    {event.project.name}
                  </span>
                  {event.source === 'egrant' && (
                    <Badge variant="secondary">{t('projects.fromEgrant')}</Badge>
                  )}
                </div>
              </div>
              <DescriptionView
                body={event.description}
                groupId={event.groupId}
                linked={event.linkedKnowledge}
                nameOf={(id) => people?.find((p) => p.id === id)?.name}
                className="text-button"
              />
              {event.files.length > 0 && <Files files={event.files} />}
              <ItemList groupId={groupId} eventId={eventId} kind="tasks" today={today} />
              <ItemList groupId={groupId} eventId={eventId} kind="tickets" today={today} />
              {doneCount > 0 && (
                <section className="flex flex-col gap-1">
                  <h3 className="text-button font-semibold">{k('done', { count: doneCount })}</h3>
                  <DonePile
                    groupId={groupId}
                    eventId={eventId}
                    count={doneCount}
                    today={today}
                    open
                  />
                </section>
              )}
            </>
          )}
        </div>
      </RowsInLayer.Provider>
      {event && layer === 'edit' && (
        <EventDialog
          groupId={groupId}
          project={event.project}
          event={event}
          onClose={() => setLayer(null)}
        />
      )}
    </SheetDialog>
  );
}

/** Every open task or ticket of the event, 20 a page; nothing when there are none. */
function ItemList({
  groupId,
  eventId,
  kind,
  today,
}: {
  groupId: string;
  eventId: string;
  kind: Exclude<EventItemsQuery['kind'], 'done'>;
  today: string;
}) {
  const { t } = useTranslation();
  const query = useInfiniteQuery(eventItemsQuery(groupId, eventId, kind));
  const pages = query.data?.pages ?? [];
  const tasks = pages.flatMap((page) => page.tasks);
  const tickets = pages.flatMap((page) => page.tickets);
  if (query.isPending) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-12 rounded-md bg-secondary" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-button text-error-ink">
        {t('projects.timeline.loadError')}
      </p>
    );
  }
  if (tasks.length === 0 && tickets.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-button font-semibold">
        {kind === 'tasks' ? t('projects.timeline.tasksTitle') : t('projects.timeline.ticketsTitle')}
      </h3>
      <ul role="list" className="-mx-1 flex flex-col">
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskRow groupId={groupId} task={task} today={today} />
          </li>
        ))}
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <TicketRow ticket={ticket} />
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t('projects.timeline.more')}
        </Button>
      )}
    </section>
  );
}
