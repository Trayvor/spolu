import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import {
  AuditQuerySchema,
  type AuditCategory,
  type AuditQuery,
  type SessionUser,
} from '@spolu/shared';
import { createDb, type Db } from '../../infra/db/client.js';
import { auditPageSql, listAudit, type AuditCursor } from './list.js';
import { oldAuditBatchSql } from './retention.js';
import { AUDIT_VOLUME, auditVolumeIds } from './test-volume.js';

// This run's clone of the audit volume's template (test/setup-explain-db.ts, ADR 0040).
const { db, close } = createDb(inject('explainDatabaseUrls').audit);
afterAll(() => close());

type PlanNode = { 'Node Type': string; 'Relation Name'?: string; Plans?: PlanNode[] };
type Explained = { Plan: PlanNode; 'Execution Time'?: number };

function seqScans(node: PlanNode): string[] {
  const own =
    node['Node Type'] === 'Seq Scan' && node['Relation Name'] ? [node['Relation Name']] : [];
  return [...own, ...(node.Plans ?? []).flatMap(seqScans)];
}

/**
 * No sequential scan of `audit_log` (always checked); with `RUN_BENCH=1` also under `ms`
 * (wall time: one warm-up, best of three).
 */
async function expectIndexed(tx: Db, query: SQL, ms: number, analyze = true): Promise<number> {
  if (analyze) await tx.execute(query);
  const plans: Explained[] = [];
  for (let run = 0; run < (analyze ? 3 : 1); run++) {
    const rows = await tx.execute<{ 'QUERY PLAN': [Explained] }>(
      analyze ? sql`explain (analyze, format json) ${query}` : sql`explain (format json) ${query}`,
    );
    plans.push([...rows][0]!['QUERY PLAN'][0]);
  }
  const time = Math.min(...plans.map((p) => p['Execution Time'] ?? 0));
  if (process.env.EXPLAIN_DEBUG) console.log(`TIME ${time} ${JSON.stringify(plans[0]!.Plan)}`);
  expect({ scanned: seqScans(plans[0]!.Plan) }).toEqual({ scanned: [] });
  if (process.env.RUN_BENCH && analyze) expect(time).toBeLessThan(ms);
  return time;
}

const DAY_MS = 86_400_000;
const bratislavaDay = (d: Date) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bratislava' }).format(d);

/** A cursor `depth` (0..1) into the two years: the page after the row there. */
function cursorAt(depth: number): AuditCursor {
  const at = new Date(Date.now() - depth * AUDIT_VOLUME.days * DAY_MS);
  return { createdAt: at.toISOString(), id: 'va-9999999' };
}

const VIEWERS: [string, AuditCategory[]][] = [
  ['a finance viewer', ['general', 'finance']],
  ['a non-finance viewer', ['general']],
];

describe('audit log query plans on 2 000 000 rows (spec §10)', () => {
  const { groupId, adminId, tokenId, taskId } = auditVolumeIds();
  const now = new Date();
  const monthAgo = bratislavaDay(new Date(now.getTime() - 200 * DAY_MS));
  const monthEnd = bratislavaDay(new Date(now.getTime() - 170 * DAY_MS));
  const day = bratislavaDay(new Date(now.getTime() - 300 * DAY_MS));
  const filters: [string, Partial<AuditQuery>][] = [
    ['no filter', {}],
    ['the task type', { entityType: 'task' }],
    ['the rate type', { entityType: 'rate' }],
    ['one task', { entityType: 'task', entityId: taskId }],
    ['one group', { group: groupId }],
    ['group and type', { group: groupId, entityType: 'ticket' }],
    [
      'a person and a month',
      { actor: { kind: 'user', id: adminId }, from: monthAgo, to: monthEnd },
    ],
    ['a token', { actor: { kind: 'token', id: tokenId } }],
    ['eGrant', { actor: { kind: 'egrant' } }],
    ['one day', { from: day, to: day }],
  ];

  for (const [viewer, categories] of VIEWERS) {
    for (const [name, filter] of filters) {
      it(
        `${name}, ${viewer}: page 1 and a cursor at 70 % use an index`,
        { timeout: 120_000 },
        async () => {
          await expectIndexed(db, auditPageSql(filter, categories, 50), 30);
          await expectIndexed(db, auditPageSql(filter, categories, 50, cursorAt(0.7)), 30);
        },
      );
    }
  }

  it('the retention batch delete uses an index', async () => {
    const cutoff = new Date(Date.now() - 729 * DAY_MS);
    // EXPLAIN without ANALYZE: nothing is deleted (the trigger would refuse young rows anyway).
    await expectIndexed(db, oldAuditBatchSql(cutoff, 5000), 30, false);
  });

  it('a page answer at the volume is under 64 kB', { timeout: 60_000 }, async () => {
    const viewer: SessionUser = {
      id: 'x',
      email: 'x@example.com',
      name: 'X',
      role: 'superadmin',
      finance: true,
    };
    const page = await listAudit(db, viewer, AuditQuerySchema.parse({ limit: 50 }));
    expect(page.items).toHaveLength(50);
    const bytes = Buffer.byteLength(JSON.stringify(page));
    if (process.env.EXPLAIN_DEBUG) console.log('page bytes', bytes);
    expect(bytes).toBeLessThan(64 * 1024);
    // The next page follows from the cursor.
    const next = await listAudit(
      db,
      viewer,
      AuditQuerySchema.parse({ limit: 50, cursor: page.nextCursor! }),
    );
    expect(next.items[0]!.id).not.toBe(page.items[0]!.id);
  });
});
