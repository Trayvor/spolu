/**
 * The group board's filters in the URL (Phase 33 part P2): `project=<id>|none` and, under a
 * chosen project, `event=<id>|none`; and (2026-10-19) `assignee=me|none|<user id>`. Spelled out without the shared schemas: the router (the
 * entry chunk) imports this file. Every key is set (an invalid one to undefined), so a raw value
 * never slips through.
 */
export type BoardSearch = { project?: string; event?: string; assignee?: string };

const id = (v: unknown) =>
  typeof v === 'string' && v.trim() && v.length <= 100 ? v.trim() : undefined;

export function validateBoardSearch(search: Record<string, unknown>): BoardSearch {
  const project = id(search.project);
  // An event only under a chosen project (the server answers 400 otherwise).
  const event = project && project !== 'none' ? id(search.event) : undefined;
  return { project, event, assignee: id(search.assignee) };
}

/** The search keys the board keeps across the panel routes and remembers per group. */
export const BOARD_FILTER_KEYS = ['project', 'event', 'assignee'] as const;
