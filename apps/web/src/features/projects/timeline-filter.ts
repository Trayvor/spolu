/**
 * The timeline's project filter (owner request 2026-10-22): all active projects, only some
 * chosen projects (archived ones too), or all active projects except some. In the URL it is
 * `?project=a,b` or `?exclude=c`; no param is all. "All except" keeps the exclusions, so a new
 * project shows up by itself; "only" keeps the choice, so it does not.
 */
export type TimelineFilter =
  { kind: 'all' } | { kind: 'only'; ids: string[] } | { kind: 'except'; ids: string[] };

export const ALL_PROJECTS: TimelineFilter = { kind: 'all' };

const list = (value: string | undefined) => (value ?? '').split(',').filter((id) => id !== '');

/** The filter of the URL's `project` and `exclude`; `project` wins when both are there. */
export function filterFromSearch(search: { project?: string; exclude?: string }): TimelineFilter {
  const only = list(search.project);
  if (only.length > 0) return { kind: 'only', ids: only };
  const except = list(search.exclude);
  return except.length > 0 ? { kind: 'except', ids: except } : ALL_PROJECTS;
}

/** The URL's params of a filter; the other one is cleared. */
export function searchOfFilter(filter: TimelineFilter): { project?: string; exclude?: string } {
  if (filter.kind === 'only') return { project: filter.ids.join(','), exclude: undefined };
  if (filter.kind === 'except') return { project: undefined, exclude: filter.ids.join(',') };
  return { project: undefined, exclude: undefined };
}

/** The one project the timeline shows, when it shows exactly one. */
export const singleProject = (filter: TimelineFilter): string | null =>
  filter.kind === 'only' && filter.ids.length === 1 ? filter.ids[0]! : null;

/** A stable key of the filter (the query key and the card's reset key). */
export const filterKey = (filter: TimelineFilter): string =>
  filter.kind === 'all' ? 'all' : `${filter.kind}:${filter.ids.join(',')}`;

/** The URL's `test=1`: the test projects count as active ones (ADR 0073). */
export const showTestFromSearch = (search: { test?: string }): boolean => search.test === '1';

type Sectioned = { status: 'active' | 'archived'; isTest: boolean };

/**
 * The filter panel's sections (ADR 0073): "All projects" covers `active`; `test` (active test
 * projects, while they are hidden) and `archived` are shown only when chosen. With `showTest`
 * the test projects are ordinary active ones. `hasTest`: the client has an active test project,
 * so the panel offers "Show test projects".
 */
export function filterSections<P extends Sectioned>(
  projects: readonly P[],
  showTest: boolean,
): { active: P[]; test: P[]; archived: P[]; hasTest: boolean } {
  const live = projects.filter((p) => p.status === 'active');
  return {
    active: showTest ? live : live.filter((p) => !p.isTest),
    test: showTest ? [] : live.filter((p) => p.isTest),
    archived: projects.filter((p) => p.status === 'archived'),
    hasTest: live.some((p) => p.isTest),
  };
}

/**
 * The ids the filter shows, out of the client's active projects and the ones shown only when
 * chosen (`archivedIds`: the archived ones and, while hidden, the test ones).
 */
export function shownIds(
  filter: TimelineFilter,
  activeIds: readonly string[],
  archivedIds: readonly string[],
): Set<string> {
  if (filter.kind === 'only') {
    const known = new Set([...activeIds, ...archivedIds]);
    return new Set(filter.ids.filter((id) => known.has(id)));
  }
  const except = new Set(filter.kind === 'except' ? filter.ids : []);
  return new Set(activeIds.filter((id) => !except.has(id)));
}

/**
 * One project ticked or unticked; the kind stays what the person chose. From all (or all
 * except), unticking an active project excludes it and ticking an archived one (or a hidden
 * test one, passed with the archived ids) turns the filter into "only" the shown projects. In "only", the ticks are the list. Unticking the last
 * shown project changes nothing (the timeline never shows no project); a list that ends up
 * with every active project and nothing else is all again.
 */
export function toggleProject(
  filter: TimelineFilter,
  id: string,
  activeIds: readonly string[],
  archivedIds: readonly string[],
): TimelineFilter {
  const shown = shownIds(filter, activeIds, archivedIds);
  if (shown.has(id)) shown.delete(id);
  else shown.add(id);
  if (shown.size === 0) return filter;
  const archivedShown = archivedIds.filter((x) => shown.has(x));
  const activeShown = activeIds.filter((x) => shown.has(x));
  if (archivedShown.length === 0 && activeShown.length === activeIds.length) return ALL_PROJECTS;
  if (filter.kind !== 'only' && archivedShown.length === 0) {
    return { kind: 'except', ids: activeIds.filter((x) => !shown.has(x)) };
  }
  return { kind: 'only', ids: [...activeShown, ...archivedShown] };
}

/** Only this one project. */
export const onlyProject = (id: string): TimelineFilter => ({ kind: 'only', ids: [id] });
