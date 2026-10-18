import type { Db } from '../../infra/db/client.js';
import type { JobHandlers } from '../../infra/jobs/jobs.js';
import { deleteOldAudit } from './audit.js';

export const MCP_AUDIT_CLEANUP_JOB = 'mcp.cleanup-audit';

/** Job handlers of the MCP module; passed to `startJobs`. */
export function mcpJobHandlers(db: Db): JobHandlers {
  return {
    // Daily: audit rows older than 180 days (`AUDIT_RETENTION_DAYS`).
    [MCP_AUDIT_CLEANUP_JOB]: async () => void (await deleteOldAudit(db)),
  };
}
