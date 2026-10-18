import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ProjectFilter } from '@spolu/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { eventPickerQuery, projectPickerQuery } from './api';
import { bratislavaToday, orderEvents } from './event-select';
import { formatEventDate, ProjectDot } from './project-dot';

// The filter pills of the lists (the ticket filters' look): 32 px, a 44 px tap area, ink when on.
const pill =
  "relative inline-flex h-8 max-w-60 items-center gap-1.5 rounded-full px-4 text-tiny font-semibold transition-colors duration-(--duration-fast) before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']";
const pillOff = 'bg-secondary text-secondary-foreground hover:bg-surface-3';
const pillOn = 'bg-primary text-primary-foreground';

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** The texts of the pills, from the caller's namespace. */
export type ProjectFilterLabels = {
  /** "Project: {{name}}" / "Event: {{name}}". */
  project: (name: string) => string;
  event: (name: string) => string;
  any: string;
  noProject: string;
  noEvent: string;
  /** The menu's line while it has nothing to offer. */
  empty: string;
};

/**
 * The Project and, once a project is chosen, the Event filter pills (Phase 33 part P2, decision
 * 19). Each is a menu: Any, None, then the client's projects (archived ones last) or the
 * project's events (coming first). The lists load when a menu opens, or at once while a value is
 * set (to name it). Changing the project drops the event.
 */
export function ProjectFilterPills({
  groupId,
  value,
  onChange,
  labels,
  eventPill = true,
}: {
  groupId: string;
  value: ProjectFilter;
  onChange: (next: ProjectFilter) => void;
  labels: ProjectFilterLabels;
  /** False on the cross-client lists: they filter by project only (decision 19). */
  eventPill?: boolean;
}) {
  const { i18n } = useTranslation();
  const [projectsWanted, setProjectsWanted] = useState(false);
  const [eventsWanted, setEventsWanted] = useState(false);
  const chosenProject = value.project && value.project !== 'none' ? value.project : null;
  const projects = useQuery({
    ...projectPickerQuery(groupId),
    enabled: projectsWanted || chosenProject !== null,
  }).data;
  const events = useQuery({
    ...eventPickerQuery(groupId, chosenProject ?? ''),
    enabled:
      eventPill &&
      chosenProject !== null &&
      (eventsWanted || (!!value.event && value.event !== 'none')),
  }).data;

  const projectName =
    value.project === undefined
      ? labels.any
      : value.project === 'none'
        ? labels.noProject
        : (projects?.find((p) => p.id === value.project)?.name ?? '…');
  const eventName =
    value.event === undefined
      ? labels.any
      : value.event === 'none'
        ? labels.noEvent
        : (events?.find((e) => e.id === value.event)?.name ?? '…');
  const ordered = orderEvents(events ?? [], bratislavaToday());

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && setProjectsWanted(true)}>
        <DropdownMenuTrigger className={cn(pill, value.project ? pillOn : pillOff)}>
          <span className="truncate">{labels.project(projectName)}</span>
          <Chevron />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 max-w-[min(320px,90vw)]">
          <DropdownMenuRadioGroup
            value={value.project ?? ''}
            onValueChange={(project) => onChange({ project: project || undefined })}
          >
            <DropdownMenuRadioItem value="">{labels.any}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="none">{labels.noProject}</DropdownMenuRadioItem>
            {projects && projects.length > 0 && <DropdownMenuSeparator />}
            {projects?.map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                <span className="flex min-w-0 items-center gap-2">
                  <ProjectDot color={p.color} className="size-2" />
                  <span className="line-clamp-2">{p.name}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {projects?.length === 0 && (
            <p className="px-3 py-2 text-micro text-muted-foreground">{labels.empty}</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {eventPill && chosenProject !== null && (
        <DropdownMenu onOpenChange={(open) => open && setEventsWanted(true)}>
          <DropdownMenuTrigger className={cn(pill, value.event ? pillOn : pillOff)}>
            <span className="truncate">{labels.event(eventName)}</span>
            <Chevron />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 max-w-[min(320px,90vw)]">
            <DropdownMenuRadioGroup
              value={value.event ?? ''}
              onValueChange={(event) =>
                onChange({ project: chosenProject, event: event || undefined })
              }
            >
              <DropdownMenuRadioItem value="">{labels.any}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="none">{labels.noEvent}</DropdownMenuRadioItem>
              {ordered.length > 0 && <DropdownMenuSeparator />}
              {ordered.map((e) => (
                <DropdownMenuRadioItem key={e.id} value={e.id}>
                  <span className="line-clamp-2">
                    {e.name} ({formatEventDate(e.occursOn, i18n.language)})
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
