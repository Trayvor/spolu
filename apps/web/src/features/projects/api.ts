import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  EgrantChangeListSchema,
  EventPickerSchema,
  ProjectDtoSchema,
  ProjectEventDtoSchema,
  ProjectPageSchema,
  ProjectPickerSchema,
  type EgrantReviewBody,
  type EventCreateBody,
  type EventPatchBody,
  type ProjectCreateBody,
  type ProjectDto,
  type ProjectEventDto,
  type ProjectPatchBody,
  type ProjectStatus,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/**
 * The projects API (Phase 33). Every key starts with `['projects', groupId, kind, …]`, so one
 * `project:changed` of the client refetches them all (`useProjectEvents`). The later parts add
 * their kinds (`timeline`, `active`) under the same prefix.
 */

const enc = encodeURIComponent;

export const projectsKey = (groupId: string, ...rest: unknown[]) => ['projects', groupId, ...rest];

/** The projects card: 30 a page by name, active or archived. */
export const projectsPageQuery = (groupId: string, status: ProjectStatus) =>
  infiniteQueryOptions({
    queryKey: projectsKey(groupId, 'list', status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status });
      if (pageParam) params.set('after', pageParam);
      return apiGet(`/groups/${enc(groupId)}/projects?${params}`, ProjectPageSchema);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

/** Every project of the client, for selects (part P2) and the timeline's project select (P4). */
export const projectPickerQuery = (groupId: string) =>
  queryOptions({
    queryKey: projectsKey(groupId, 'picker'),
    queryFn: () => apiGet(`/groups/${enc(groupId)}/projects/picker`, ProjectPickerSchema),
  });

export const projectQuery = (groupId: string, id: string) =>
  queryOptions({
    queryKey: projectsKey(groupId, 'project', id),
    queryFn: () => apiGet(`/projects/${enc(id)}`, ProjectDtoSchema),
  });

/** A project's events by date (the project sheet; the event select of part P2). */
export const eventPickerQuery = (groupId: string, projectId: string) =>
  queryOptions({
    queryKey: projectsKey(groupId, 'events', projectId),
    queryFn: () => apiGet(`/projects/${enc(projectId)}/events/picker`, EventPickerSchema),
  });

export const eventQuery = (groupId: string, id: string) =>
  queryOptions({
    queryKey: projectsKey(groupId, 'event', id),
    queryFn: () => apiGet(`/project-events/${enc(id)}`, ProjectEventDtoSchema),
  });

export function createProject(groupId: string, body: ProjectCreateBody): Promise<ProjectDto> {
  return apiSend('POST', `/groups/${enc(groupId)}/projects`, body, ProjectDtoSchema);
}

export function updateProject(id: string, patch: ProjectPatchBody): Promise<ProjectDto> {
  return apiSend('PATCH', `/projects/${enc(id)}`, patch, ProjectDtoSchema);
}

export function setProjectArchived(id: string, archived: boolean): Promise<ProjectDto> {
  const path = `/projects/${enc(id)}/${archived ? 'archive' : 'restore'}`;
  return apiSend('POST', path, {}, ProjectDtoSchema);
}

export async function deleteProject(id: string): Promise<void> {
  await apiSend('DELETE', `/projects/${enc(id)}`);
}

export function removeAlias(id: string, key: string): Promise<ProjectDto> {
  return apiSend('DELETE', `/projects/${enc(id)}/aliases/${enc(key)}`, undefined, ProjectDtoSchema);
}

export function createEvent(projectId: string, body: EventCreateBody): Promise<ProjectEventDto> {
  return apiSend('POST', `/projects/${enc(projectId)}/events`, body, ProjectEventDtoSchema);
}

export function updateEvent(id: string, patch: EventPatchBody): Promise<ProjectEventDto> {
  return apiSend('PATCH', `/project-events/${enc(id)}`, patch, ProjectEventDtoSchema);
}

export async function deleteEvent(id: string): Promise<void> {
  await apiSend('DELETE', `/project-events/${enc(id)}`);
}

/** "Changes from eGrant" of one project (part P3): the pending rows with the current values. */
export const egrantChangesQuery = (groupId: string, projectId: string) =>
  queryOptions({
    queryKey: projectsKey(groupId, 'egrant', projectId),
    queryFn: () => apiGet(`/projects/${enc(projectId)}/egrant-changes`, EgrantChangeListSchema),
  });

/** "Save choices": applies the accepted rows and dismisses the others named, in one save. */
export function reviewEgrantChanges(
  projectId: string,
  body: EgrantReviewBody,
): Promise<ProjectDto> {
  return apiSend('POST', `/projects/${enc(projectId)}/egrant-changes`, body, ProjectDtoSchema);
}

/** Merges the project into `into` of the same client; answers the survivor. */
export function mergeProject(projectId: string, into: string): Promise<ProjectDto> {
  return apiSend('POST', `/projects/${enc(projectId)}/merge`, { into }, ProjectDtoSchema);
}
