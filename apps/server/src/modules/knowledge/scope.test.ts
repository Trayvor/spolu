import { describe, expect, it } from 'vitest';
import type { Db } from '../../infra/db/client.js';
import { managedGroupIdsOf } from './scope.js';

describe('managedGroupIdsOf', () => {
  it('managedGroupIdsOf returns null before Phase 18', async () => {
    expect(await managedGroupIdsOf({} as Db, 'admin')).toBeNull();
  });
});
