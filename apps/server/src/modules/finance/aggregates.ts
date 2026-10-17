/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures until part C fills them */
import type { SQL } from 'drizzle-orm';
import type { FinanceOverviewDto } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { FinanceScope, MonthRange } from './scope.js';

/**
 * Money and hours (Phase 32, spec §3.4, §6.1): part C owns this file and replaces the stubs. D
 * calls `overview` with a `groups` or `all` scope.
 */

const notImplemented = (): never => {
  throw new Error('not implemented (Phase 32 part C)');
};

/**
 * The cost in EUR minor units of the time entries aliased `entries`: the rate lookup (a
 * `left join lateral` on `finance_rates (user_id, effective_from desc)`), rounded once per total.
 */
export function costSql(_entries: string): SQL {
  return notImplemented();
}

export async function overview(
  _db: Db,
  _scope: FinanceScope,
  _range: MonthRange,
): Promise<FinanceOverviewDto> {
  return notImplemented();
}
