import type { Db } from '../../infra/db/client.js';

/**
 * Reactions to a merge of two projects inside its transaction (Phase 33 part P6). Modules that
 * keep their own copy of project ids register here at start-up, so the projects module calls
 * them without importing them: the finance module moves its time entries and contracts
 * (`registerFinanceProjectHooks`), and the projects module never reads or imports finance (the
 * seal, `finance/seal.test.ts`). Part P3's `mergeProjects` calls `runProjectMergeHooks` once,
 * after the events moved and before the merged project is deleted.
 */
export type ProjectMerge = { groupId: string; fromProjectId: string; intoProjectId: string };

type ProjectMergeHook = (tx: Db, merge: ProjectMerge) => Promise<void>;
const hooks: ProjectMergeHook[] = [];

/** Registers a reaction to merges; called once per hook at start-up (a repeat is ignored). */
export function onProjectMerge(hook: ProjectMergeHook): void {
  if (!hooks.includes(hook)) hooks.push(hook);
}

/** Runs every hook in the merge's transaction: a failing hook fails the merge (no half move). */
export async function runProjectMergeHooks(tx: Db, merge: ProjectMerge): Promise<void> {
  for (const hook of hooks) await hook(tx, merge);
}
