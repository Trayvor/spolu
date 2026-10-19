import { inArray } from 'drizzle-orm';
import { registerAuditResolver } from '../audit/resolvers.js';
import { user } from './schema.js';

/** The live-record resolver of `admin`: the person still exists (users are never deleted). */
export function registerUsersAuditResolvers(): void {
  registerAuditResolver('admin', {
    async existingIds(db, ids) {
      const rows = await db.select({ id: user.id }).from(user).where(inArray(user.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
}
