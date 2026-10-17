/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures until part B fills them */
import type { FinanceItemPage, FinanceItemType } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { FinanceScope } from './scope.js';

/**
 * Finance items (Phase 32, spec §3.2, §6.1): contracts, documents and notes. Part B owns this
 * file and replaces the stub. D's global contracts table and the finance search call `listItems`
 * with a `groups` or `all` scope.
 */

export type ListItemsFilter = {
  folderId?: string;
  type?: FinanceItemType;
  q?: string;
  after?: string;
  sort?: 'created' | 'start' | 'end' | 'amount';
};

export async function listItems(
  _db: Db,
  _scope: FinanceScope,
  _filter: ListItemsFilter,
): Promise<FinanceItemPage> {
  throw new Error('not implemented (Phase 32 part B)');
}
