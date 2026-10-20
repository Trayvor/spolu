import { z } from 'zod';

/**
 * The audit log („História zmien", spec 2026-10-19-audit-log-design.md): who changed what and
 * when. The catalogue of entity types and their actions, the field allowlist with each field's
 * kind (what is stored for it), the query of `GET /api/audit` and its answer.
 */

export const AUDIT_CATEGORIES = ['general', 'finance'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** Entity type → its actions and category (spec §3.1). */
export const AUDIT_CATALOGUE = {
  group: {
    category: 'general',
    actions: ['created', 'updated', 'invite_regenerated', 'deactivated', 'reactivated'],
  },
  membership: {
    category: 'general',
    actions: ['added', 'invited', 'invite_cancelled', 'removed', 'restored'],
  },
  manager: { category: 'general', actions: ['added', 'removed'] },
  admin: { category: 'general', actions: ['added', 'deactivated', 'renamed'] },
  substitution: { category: 'general', actions: ['started', 'ended'] },
  finance_access: { category: 'finance', actions: ['granted', 'revoked'] },
  task: {
    category: 'general',
    actions: ['created', 'updated', 'moved', 'completed', 'reopened', 'deleted'],
  },
  bucket: { category: 'general', actions: ['created', 'renamed', 'deleted'] },
  ticket: {
    category: 'general',
    actions: ['created', 'updated', 'assignee_added', 'assignee_removed'],
  },
  knowledge_item: {
    category: 'general',
    actions: ['created', 'updated', 'deleted', 'recording_deleted'],
  },
  knowledge_folder: { category: 'general', actions: ['created', 'updated', 'deleted'] },
  project: {
    category: 'general',
    actions: ['created', 'updated', 'status_changed', 'merged', 'alias_removed', 'deleted'],
  },
  project_event: { category: 'general', actions: ['created', 'updated', 'deleted'] },
  // `migrated`: a salary expense that migration 0069 made a salary (2026-10-21).
  finance_item: { category: 'finance', actions: ['created', 'updated', 'deleted', 'migrated'] },
  salary: { category: 'finance', actions: ['created', 'updated', 'deleted', 'migrated'] },
  finance_folder: { category: 'finance', actions: ['created', 'updated', 'deleted'] },
  time_entry: { category: 'finance', actions: ['created', 'updated', 'deleted'] },
  rate: { category: 'finance', actions: ['created', 'deleted'] },
  mcp_token: { category: 'general', actions: ['created', 'revoked'] },
  oauth_connection: { category: 'general', actions: ['approved', 'revoked'] },
  passkey: { category: 'general', actions: ['added', 'deleted'] },
  bulk_campaign: { category: 'general', actions: ['sent', 'cancelled'] },
  ticket_rating: { category: 'general', actions: ['created', 'updated'] },
  weekly_summary: { category: 'general', actions: ['sent'] },
  weekly_summary_setting: { category: 'general', actions: ['updated'] },
  // A client's area → admin table (2026-10-21), one row per save, under the group's id.
  ticket_area_rules: { category: 'general', actions: ['updated'] },
} as const satisfies Record<string, { category: AuditCategory; actions: readonly string[] }>;

export type AuditEntityType = keyof typeof AUDIT_CATALOGUE;
export type AuditAction = (typeof AUDIT_CATALOGUE)[AuditEntityType]['actions'][number];
export const AUDIT_ENTITY_TYPES = Object.keys(AUDIT_CATALOGUE) as AuditEntityType[];
export const AuditEntityTypeSchema = z.enum(
  AUDIT_ENTITY_TYPES as [AuditEntityType, ...AuditEntityType[]],
);

export function auditCategoryOf(type: AuditEntityType): AuditCategory {
  return AUDIT_CATALOGUE[type].category;
}

export function isAuditAction(type: AuditEntityType, action: string): action is AuditAction {
  return (AUDIT_CATALOGUE[type].actions as readonly string[]).includes(action);
}

/**
 * What is stored for a field (spec §3.2): `value` from/to (short scalars, cut at 200 characters),
 * `ref` from/to as `{ id, label }`, `refs` added/removed, `text` only `{ changed: true }` (never
 * the text), `money` minor units and currency, `minutes` from/to. Secrets are never listed.
 */
export type AuditFieldKind = 'value' | 'ref' | 'refs' | 'text' | 'money' | 'minutes';

/** Entity type → field → kind. Only these fields are ever diffed (spec §3.2). */
export const AUDIT_FIELDS: {
  readonly [T in AuditEntityType]: Readonly<Record<string, AuditFieldKind>>;
} = {
  group: { name: 'value', egrantUrl: 'value', logo: 'text' },
  membership: { role: 'value', group: 'ref' },
  manager: { group: 'ref' },
  admin: { name: 'value' },
  substitution: { substituted: 'ref', substitute: 'ref', endsOn: 'value' },
  finance_access: {},
  task: {
    title: 'value',
    description: 'text',
    dueDate: 'value',
    urgent: 'value',
    link: 'value',
    bucket: 'ref',
    assignees: 'refs',
    project: 'ref',
    event: 'ref',
    files: 'refs',
  },
  bucket: { name: 'value' },
  ticket: {
    subject: 'value',
    status: 'value',
    area: 'value',
    programme: 'value',
    dueDate: 'value',
    url: 'value',
    body: 'text',
    client: 'ref',
    project: 'ref',
    event: 'ref',
    assignees: 'refs',
  },
  knowledge_item: {
    title: 'value',
    type: 'value',
    visibility: 'value',
    folder: 'ref',
    body: 'text',
    url: 'value',
    meetingAt: 'value',
    transcript: 'text',
    summary: 'text',
    links: 'refs',
    files: 'refs',
  },
  knowledge_folder: { name: 'value', visibility: 'value', parent: 'ref' },
  project: {
    name: 'value',
    status: 'value',
    description: 'text',
    aliases: 'refs',
    merged: 'ref',
  },
  project_event: { name: 'value', date: 'value', description: 'text' },
  finance_item: {
    title: 'value',
    type: 'value',
    contractNumber: 'value',
    amount: 'money',
    periodFrom: 'value',
    periodTo: 'value',
    payer: 'value',
    payee: 'ref',
    shares: 'refs',
    folder: 'ref',
    project: 'ref',
    note: 'text',
    files: 'refs',
    /** An expense's linked documents (2026-10-21). */
    documents: 'refs',
    /** A migrated salary expense: the salary it became (migration 0069). */
    salary: 'ref',
  },
  salary: {
    person: 'ref',
    month: 'value',
    amount: 'money',
    note: 'text',
    files: 'refs',
    documents: 'refs',
    /** A salary made by migration 0069: the expense it was. */
    expense: 'ref',
  },
  finance_folder: { name: 'value', parent: 'ref' },
  time_entry: {
    minutes: 'minutes',
    workedOn: 'value',
    person: 'ref',
    task: 'ref',
    ticket: 'ref',
    client: 'ref',
    project: 'ref',
    note: 'text',
  },
  rate: { amount: 'money', validFrom: 'value', person: 'ref' },
  mcp_token: { name: 'value', scope: 'value', expiresAt: 'value' },
  oauth_connection: { client: 'value', scope: 'value' },
  passkey: { name: 'value' },
  bulk_campaign: { subject: 'value', recipients: 'value' },
  // The rater's thumbs; the comment is free text, so only "changed" (2026-10-19).
  ticket_rating: { rating: 'value', comment: 'text' },
  weekly_summary: { week: 'value', recipients: 'value' },
  weekly_summary_setting: { enabled: 'value' },
  // Each row as `{ id: "<user id>:<area key>", label: "<area> → <admin>" }`.
  ticket_area_rules: { rules: 'refs' },
};

export type AuditRef = { id: string; label: string };
export type AuditMoney = { minor: number; currency: string };
export type AuditScalar = string | number | boolean | null;
export type AuditChange =
  | { from?: AuditScalar; to?: AuditScalar }
  | { from?: AuditRef | null; to?: AuditRef | null }
  | { added: AuditRef[]; removed: AuditRef[] }
  | { changed: true }
  | { from?: AuditMoney | null; to?: AuditMoney | null };
export type AuditChanges = {
  [field: string]: AuditChange | true | { count: number } | undefined;
} & {
  _truncated?: true;
  _batch?: { count: number };
};

export const AUDIT_LIMITS = {
  pageDefault: 50,
  pageMax: 100,
  valueChars: 200,
  labelChars: 200,
  refsMax: 50,
  changesBytes: 8192,
  rangeDays: 1096,
  retentionDays: 730,
} as const;

export const AUDIT_EGRANT_SOURCES = [
  'groups',
  'managers',
  'intake',
  'projects',
  'ticket_areas',
] as const;
export type AuditEgrantSource = (typeof AUDIT_EGRANT_SOURCES)[number];

export type AuditActorFilter =
  | { kind: 'user'; id: string }
  | { kind: 'token'; id: string }
  | { kind: 'egrant' | 'system' | 'mcp' };

/** `user:<id>` | `token:<id>` | `kind:egrant` | `kind:system` | `kind:mcp`. */
export const AuditActorFilterSchema: z.ZodType<AuditActorFilter, string> = z
  .string()
  .transform((s, ctx): AuditActorFilter => {
    const at = s.indexOf(':');
    const prefix = at < 0 ? '' : s.slice(0, at);
    const rest = at < 0 ? '' : s.slice(at + 1);
    if ((prefix === 'user' || prefix === 'token') && rest.length > 0 && rest.length <= 100) {
      return { kind: prefix, id: rest };
    }
    if (prefix === 'kind' && (rest === 'egrant' || rest === 'system' || rest === 'mcp')) {
      return { kind: rest };
    }
    ctx.addIssue({ code: 'custom', message: 'invalid actor' });
    return z.NEVER;
  });

const DAY_MS = 86_400_000;

/** A real calendar day `YYYY-MM-DD` (no 30 February). */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'invalid date');

export const AuditQuerySchema = z
  .object({
    entityType: AuditEntityTypeSchema.optional(),
    entityId: z.string().min(1).max(200).optional(),
    group: z.string().min(1).max(100).optional(),
    actor: AuditActorFilterSchema.optional(),
    from: isoDay.optional(),
    to: isoDay.optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(AUDIT_LIMITS.pageMax)
      .default(AUDIT_LIMITS.pageDefault),
  })
  .refine((q) => q.entityId === undefined || q.entityType !== undefined, {
    message: 'entityId needs entityType',
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from after to' })
  .refine(
    (q) =>
      !q.from ||
      !q.to ||
      (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / DAY_MS <=
        AUDIT_LIMITS.rangeDays,
    { message: 'range too long' },
  );
export type AuditQuery = z.output<typeof AuditQuerySchema>;

export const AuditActorDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    userId: z.string(),
    name: z.string(),
    deactivated: z.boolean(),
  }),
  z.object({
    kind: z.literal('mcp'),
    userId: z.string(),
    name: z.string(),
    tokenId: z.string(),
    tokenName: z.string(),
    deactivated: z.boolean(),
  }),
  z.object({
    kind: z.literal('egrant'),
    source: z.enum(AUDIT_EGRANT_SOURCES),
    instance: z.string(),
  }),
  z.object({ kind: z.literal('system'), job: z.string() }),
]);
export type AuditActorDto = z.infer<typeof AuditActorDtoSchema>;

export const AuditEntryDtoSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  actor: AuditActorDtoSchema,
  entityType: AuditEntityTypeSchema,
  entityId: z.string(),
  entityLabel: z.string(),
  /** The live record exists and the viewer may open it (a link is shown). */
  linkable: z.boolean(),
  group: z.object({ id: z.string(), name: z.string() }).nullable(),
  action: z.string(),
  changes: z.record(z.string(), z.unknown()),
  cause: z
    .object({
      id: z.string(),
      entityType: AuditEntityTypeSchema,
      action: z.string(),
      entityLabel: z.string(),
    })
    .nullable(),
});
export type AuditEntryDto = Omit<
  z.infer<typeof AuditEntryDtoSchema>,
  'action' | 'changes' | 'cause'
> & {
  action: AuditAction;
  changes: AuditChanges;
  cause: {
    id: string;
    entityType: AuditEntityType;
    action: AuditAction;
    entityLabel: string;
  } | null;
};

export const AuditPageSchema = z.object({
  items: z.array(AuditEntryDtoSchema),
  nextCursor: z.string().nullable(),
});
export type AuditPage = { items: AuditEntryDto[]; nextCursor: string | null };
