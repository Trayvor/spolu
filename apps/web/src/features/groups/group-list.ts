import type { GroupSummary } from '@spolu/shared';

/** The Groups page's manager filter, from `?manager=`: `me`, `none` or an admin id. */
export type ManagerFilterValue = string | undefined;

/** Groups I manage first, then the rest; each part keeps the server's name order. */
export function sortMineFirst(groups: readonly GroupSummary[]): GroupSummary[] {
  return [...groups.filter((g) => g.managedByMe), ...groups.filter((g) => !g.managedByMe)];
}

/** Whether `manager` names an admin that the filter can use (`me` and `none` always can). */
export function isKnownManager(
  manager: ManagerFilterValue,
  adminIds: ReadonlySet<string> | null,
): boolean {
  return manager === 'me' || manager === 'none' || (!!manager && !!adminIds?.has(manager));
}

/**
 * The groups that match the manager filter: `me` the groups I manage, `none` those without a
 * manager, an admin id those that admin manages. No filter, an id that is not an active admin
 * (an old link) or any id while the admins are still loading (`adminIds` null) gives every group.
 */
export function filterByManager(
  groups: readonly GroupSummary[],
  manager: ManagerFilterValue,
  adminIds: ReadonlySet<string> | null,
): GroupSummary[] {
  if (!isKnownManager(manager, adminIds)) return [...groups];
  if (manager === 'me') return groups.filter((g) => g.managedByMe);
  if (manager === 'none') return groups.filter((g) => g.managers.length === 0);
  return groups.filter((g) => g.managers.some((m) => m.id === manager));
}
