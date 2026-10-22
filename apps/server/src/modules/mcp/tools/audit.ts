import { z } from 'zod';
import { AUDIT_LIMITS, AuditEntityTypeSchema } from '@spolu/shared';
import { defineTool, fromApi, query, type ToolDef } from './define.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The admins' audit log ("História zmien"); finance rows only for the finance right. */
export const auditTools: ToolDef[] = [
  defineTool({
    name: 'list_audit_log',
    admin: true,
    title: 'List the audit log',
    description:
      'The audit log („História zmien“), newest first: who changed what and when, with the changed fields. Filters: `entityType` (task, ticket, project, knowledge_item, group, membership, …) and `entityId` (one record; needs `entityType`), `group` (a client’s id), `actor` (the author: "user:<id>", "token:<id>", "kind:egrant", "kind:system" or "kind:mcp"), `from`/`to` (days, at most a year apart). Finance rows only for the finance right. Paged with `cursor` from `nextCursor`.',
    input: z.object({
      entityType: AuditEntityTypeSchema.optional(),
      entityId: z.string().min(1).max(200).optional(),
      group: z.string().min(1).max(100).optional(),
      actor: z.string().min(1).max(120).optional(),
      from: day.optional(),
      to: day.optional(),
      cursor: z.string().min(1).max(200).optional(),
      limit: z.number().int().min(1).max(AUDIT_LIMITS.pageMax).optional(),
    }),
    run: async ({ api }, args) => fromApi(await api('GET', '/api/audit', { query: query(args) })),
  }),
];
