import type { SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

/**
 * An extra way to read a file that `canReadFile` (the file's group) does not give: another
 * module registers it at start-up without the files module importing that module (Phase 21: the
 * chat lets a ziadatel read the files of their ticket's chat). Rules only add access, never take it.
 */
export type FileReadRule = (
  db: Db,
  actor: SessionUser,
  file: { id: string; groupId: string | null; adminsOnly: boolean },
) => Promise<boolean>;

const rules: FileReadRule[] = [];

export function registerFileReadRule(rule: FileReadRule): void {
  if (!rules.includes(rule)) rules.push(rule);
}

/** Whether any registered rule lets the actor read the file (an admins-only file never). */
export async function readableByRule(
  db: Db,
  actor: SessionUser,
  file: { id: string; groupId: string | null; adminsOnly: boolean },
): Promise<boolean> {
  if (file.adminsOnly) return false;
  for (const rule of rules) if (await rule(db, actor, file)) return true;
  return false;
}
