/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures until part C fills them */
import type { WorkLogPageDto } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { FinanceScope, MonthRange } from './scope.js';

/**
 * The work log (Phase 32, spec §6.1): part C owns this file and replaces the stub. `range` null
 * is all time; `before` the cursor of the older page. D calls it with a `groups` or `all` scope.
 */
export async function workLogPage(
  _db: Db,
  _scope: FinanceScope,
  _range: MonthRange | null,
  _before: string | null,
): Promise<WorkLogPageDto> {
  throw new Error('not implemented (Phase 32 part C)');
}
