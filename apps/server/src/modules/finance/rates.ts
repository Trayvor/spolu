import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import {
  COST_CURRENCY,
  type AddRateBody,
  type Rate,
  type RatesDto,
  type SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { user } from '../users/schema.js';
import { getUserNames } from '../users/service.js';
import { emitFinanceChanged } from './events.js';
import { canManageRates } from './policy.js';
import { financeRates } from './schema.js';

/**
 * Hourly rates (Phase 32, spec §3.4, decision 10). An entry's rate is its admin's row with the
 * latest `effective_from <= worked_on`, a null `effective_from` ("from the start") counting as
 * the earliest; `costSql` in `aggregates.ts` does that lookup in SQL, `rateOn` here in memory.
 * Rates are in EUR (`COST_CURRENCY`). Adding a rate for a day that already has one replaces it
 * (a correction), so the unique `(user_id, effective_from)` never answers 409.
 */

/** The actor is no finance admin (the routes' `requireFinance` already refuses: 403). */
export class RatesForbiddenError extends Error {
  constructor() {
    super('Not a finance admin');
    this.name = 'RatesForbiddenError';
  }
}

/** The rate's user is no admin (a client, an unknown id): 400. */
export class RateUserError extends Error {
  constructor() {
    super('Rates are for admins only');
    this.name = 'RateUserError';
  }
}

export class RateNotFoundError extends Error {
  constructor() {
    super('No such rate');
    this.name = 'RateNotFoundError';
  }
}

type RateRow = typeof financeRates.$inferSelect;

/** The row that applies on `day` (`YYYY-MM-DD`) among one admin's rates; null when none does. */
export function rateOn<T extends { effectiveFrom: string | null }>(
  rates: readonly T[],
  day: string,
): T | null {
  let best: T | null = null;
  for (const rate of rates) {
    if (rate.effectiveFrom !== null && rate.effectiveFrom > day) continue;
    if (best === null || (best.effectiveFrom ?? '') < (rate.effectiveFrom ?? '')) best = rate;
  }
  return best;
}

/** History order: the newest `effective_from` first, "from the start" last. */
function byNewest(a: { effectiveFrom: string | null }, b: { effectiveFrom: string | null }) {
  return (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? '');
}

/** Today in Europe/Bratislava, `YYYY-MM-DD`. */
export function financeToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(now);
}

/**
 * `GET /api/finance/rates`: every active admin, and every deactivated admin who has a rate, with
 * the rate that applies today and the history (newest first). Two queries; the table is small
 * (a few rows per admin).
 */
export async function listRates(db: Db): Promise<RatesDto> {
  const rates = await db.select().from(financeRates);
  const ratedIds = [...new Set(rates.map((r) => r.userId))];
  const people = await db
    .select({ id: user.id, name: user.name, disabledAt: user.disabledAt, role: user.role })
    .from(user)
    .where(
      and(
        inArray(user.role, ['admin', 'superadmin']),
        ratedIds.length > 0
          ? or(isNull(user.disabledAt), inArray(user.id, ratedIds))
          : isNull(user.disabledAt),
      ),
    )
    .orderBy(sql`${user.disabledAt} is not null`, user.name, user.id);
  const names = await getUserNames(
    db,
    rates.map((r) => r.createdBy),
  );
  const today = financeToday();
  const toDto = (row: RateRow): Rate => ({
    id: row.id,
    userId: row.userId,
    rateMinor: row.rateMinor,
    currency: row.currency,
    effectiveFrom: row.effectiveFrom,
    createdBy: row.createdBy,
    createdByName: names.get(row.createdBy) ?? '',
    createdAt: row.createdAt.toISOString(),
  });
  return {
    admins: people.map((person) => {
      const own = rates.filter((r) => r.userId === person.id).sort(byNewest);
      const current = rateOn(own, today);
      return {
        userId: person.id,
        name: person.name,
        active: person.disabledAt === null,
        current: current ? toDto(current) : null,
        history: own.map(toDto),
      };
    }),
  };
}

type RateDeps = { db: Db; io: SocketIOServer };

/** `POST /api/finance/rates`: a rate from a day on (or from the start); the same day replaces. */
export async function addRate(
  { db, io }: RateDeps,
  actor: SessionUser,
  input: AddRateBody,
): Promise<Rate> {
  if (!canManageRates(actor)) throw new RatesForbiddenError();
  const [target] = await db.select({ role: user.role }).from(user).where(eq(user.id, input.userId));
  if (!target || target.role === 'client') throw new RateUserError();
  const sameDay = and(
    eq(financeRates.userId, input.userId),
    input.effectiveFrom === null
      ? isNull(financeRates.effectiveFrom)
      : eq(financeRates.effectiveFrom, input.effectiveFrom),
  );
  // The same day corrects the row; the unique index catches a concurrent duplicate (500, rare).
  const [replaced] = await db
    .update(financeRates)
    .set({ rateMinor: input.rateMinor, createdBy: actor.id, createdAt: new Date() })
    .where(sameDay)
    .returning();
  const [row] = replaced
    ? [replaced]
    : await db
        .insert(financeRates)
        .values({
          id: randomUUID(),
          userId: input.userId,
          rateMinor: input.rateMinor,
          currency: COST_CURRENCY,
          effectiveFrom: input.effectiveFrom,
          createdBy: actor.id,
        })
        .returning();
  emitFinanceChanged(io, null, 'rates');
  return {
    id: row!.id,
    userId: row!.userId,
    rateMinor: row!.rateMinor,
    currency: row!.currency,
    effectiveFrom: row!.effectiveFrom,
    createdBy: actor.id,
    createdByName: actor.name,
    createdAt: row!.createdAt.toISOString(),
  };
}

/** `DELETE /api/finance/rates/:id`: a mistaken row goes; costs follow on the next read. */
export async function deleteRate(
  { db, io }: RateDeps,
  actor: SessionUser,
  id: string,
): Promise<void> {
  if (!canManageRates(actor)) throw new RatesForbiddenError();
  const deleted = await db
    .delete(financeRates)
    .where(eq(financeRates.id, id))
    .returning({ id: financeRates.id });
  if (deleted.length === 0) throw new RateNotFoundError();
  emitFinanceChanged(io, null, 'rates');
}
