import { expect } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../src/infra/db/client.js';

/** Helpers of the EXPLAIN checks (`modules/*\/explain.test.ts`, ADR 0040). */
export type PlanNode = { 'Node Type': string; 'Relation Name'?: string; Plans?: PlanNode[] };
type Explained = { Plan: PlanNode; 'Execution Time': number };

/** The relations a plan reads with a sequential scan. */
export function seqScans(node: PlanNode): string[] {
  const own =
    node['Node Type'] === 'Seq Scan' && node['Relation Name'] ? [node['Relation Name']] : [];
  return [...own, ...(node.Plans ?? []).flatMap(seqScans)];
}

/** `query` explained and run: one warm-up, then the best of three; its plan and time in ms. */
export async function explainBest(tx: Db, query: SQL): Promise<{ plan: PlanNode; time: number }> {
  await tx.execute(query);
  const plans: Explained[] = [];
  for (let run = 0; run < 3; run++) {
    const rows = await tx.execute<{ 'QUERY PLAN': [Explained] }>(
      sql`explain (analyze, format json) ${query}`,
    );
    plans.push([...rows][0]!['QUERY PLAN'][0]);
  }
  const time = Math.min(...plans.map((p) => p['Execution Time']));
  if (process.env.EXPLAIN_DEBUG) console.log(time, JSON.stringify(plans[0], null, 1));
  return { plan: plans[0]!.Plan, time };
}

/**
 * Asserts that `query` reads none of `tables` with a sequential scan (always checked). The bound
 * in milliseconds is wall time, so it only runs with `RUN_BENCH=1`: one warm-up, best of three.
 */
export async function expectIndexed(
  tx: Db,
  query: SQL,
  tables: string[],
  ms: number,
): Promise<void> {
  const { plan, time } = await explainBest(tx, query);
  const scanned = seqScans(plan).filter((t) => tables.includes(t));
  expect({ scanned }).toEqual({ scanned: [] });
  if (process.env.RUN_BENCH) expect(time).toBeLessThan(ms);
}
