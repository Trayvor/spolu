import { inArray } from 'drizzle-orm';
import { registerAuditResolver } from '../audit/resolvers.js';
import { bulkCampaigns } from './schema.js';

/** The live-record resolver of `bulk_campaign` (registered by `app.ts`). */
export function registerBulkEmailAuditResolvers(): void {
  registerAuditResolver('bulk_campaign', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: bulkCampaigns.id })
        .from(bulkCampaigns)
        .where(inArray(bulkCampaigns.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
}
