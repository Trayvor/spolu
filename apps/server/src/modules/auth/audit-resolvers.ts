import { inArray } from 'drizzle-orm';
import { registerAuditResolver } from '../audit/resolvers.js';
import { passkeys } from './schema.js';

/** The live-record resolver of `passkey` (registered by `app.ts`). */
export function registerAuthAuditResolvers(): void {
  registerAuditResolver('passkey', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: passkeys.id })
        .from(passkeys)
        .where(inArray(passkeys.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
}
