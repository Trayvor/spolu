import { and, asc, eq, gt, isNotNull, lte, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import { TICKET_CONFIRM_DAYS } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../infra/db/client.js';
import type { JobHandlers, JobSchedule } from '../../infra/jobs/jobs.js';
import { systemActor } from '../audit/actor.js';
import { emitTicket } from './events.js';
import { runTicketChange } from './hooks.js';
import { tickets } from './schema.js';
import { updateTicket, type TicketRow } from './service.js';

/** Resolves the tickets whose "solved on our side" mark is five days old (design 5.3). */
export const AUTO_RESOLVE_JOB = 'tickets.auto-resolve';

const BATCH = 100;

/**
 * What the job needs after a commit: the app's deps, its sockets and its logger. `pageSize` and
 * `afterLock` are test seams: a smaller page, and a step inside the ticket's transaction right
 * after its lock (a test makes it fail, or hold the lock).
 */
export type TicketJobContext = {
  deps: AppDeps;
  io: SocketIOServer;
  log: FastifyBaseLogger;
  pageSize?: number;
  afterLock?: (ticketId: string) => Promise<void>;
};

const dueWhere = (cutoff: Date) =>
  and(
    eq(tickets.status, 'in_progress'),
    isNotNull(tickets.adminDoneAt),
    lte(tickets.adminDoneAt, cutoff),
  );

/** One page of the job, after the keyset `after`, on the partial index of `admin_done_at`. */
export function dueTicketsQuery(
  db: Db,
  cutoff: Date,
  after: { at: Date; id: string } | null,
  limit: number,
) {
  return db
    .select({ id: tickets.id, at: tickets.adminDoneAt })
    .from(tickets)
    .where(
      after
        ? and(
            dueWhere(cutoff),
            or(
              gt(tickets.adminDoneAt, after.at),
              and(eq(tickets.adminDoneAt, after.at), gt(tickets.id, after.id)),
            ),
          )
        : dueWhere(cutoff),
    )
    .orderBy(asc(tickets.adminDoneAt), asc(tickets.id))
    .limit(limit);
}

/**
 * Resolves every ticket marked "solved on our side" at or before `now` minus five days, and says
 * how many it resolved. Each ticket has its own transaction: the row is locked with
 * `for update skip locked` (a decline or a message holding it makes the job skip it until the next
 * run), the mark is checked again on the locked row, and `updateTicket` writes inside that
 * transaction as the system (no actor: no time dialog, `ticket.resolved` goes to the full
 * audience). A ticket that fails is logged and left for the next run without stopping the others.
 * The announcement (socket event, hooks) follows each commit. The author is not looked at: one who
 * lost access does not keep the ticket open. Pages go by keyset on `(admin_done_at, id)`, so
 * tickets that keep failing or stay locked never hide the ones behind them; it ends on an empty
 * page.
 */
export async function autoResolveDue(ctx: TicketJobContext, now: Date): Promise<number> {
  const { db } = ctx.deps;
  const pageSize = ctx.pageSize ?? BATCH;
  const cutoff = new Date(now.getTime() - TICKET_CONFIRM_DAYS * 86_400_000);
  const by = systemActor(AUTO_RESOLVE_JOB);
  let after: { at: Date; id: string } | null = null;
  let resolved = 0;
  for (;;) {
    const page: { id: string; at: Date | null }[] = await dueTicketsQuery(
      db,
      cutoff,
      after,
      pageSize,
    );
    if (page.length === 0) return resolved;
    for (const { id } of page) {
      try {
        const done = await db.transaction(async (tx): Promise<TicketRow | null> => {
          const [locked] = await tx
            .select()
            .from(tickets)
            .where(and(eq(tickets.id, id), dueWhere(cutoff)))
            .for('update', { skipLocked: true });
          if (!locked?.adminDoneAt || locked.adminDoneAt > cutoff) return null;
          await ctx.afterLock?.(id);
          const result = await updateTicket(
            tx,
            id,
            { status: 'resolved' },
            null,
            by,
            'in_progress',
          );
          return result?.statusChanged ? result.ticket : null;
        });
        if (!done) continue;
        resolved += 1;
        emitTicket(ctx.io, 'updated', done);
        await runTicketChange(ctx.deps, { kind: 'status', ticket: done, actorId: null }, ctx.log);
      } catch (error) {
        ctx.log.error({ err: error, ticketId: id }, 'ticket auto-resolve failed');
      }
    }
    const last = page[page.length - 1]!;
    after = { at: last.at!, id: last.id };
  }
}

let attached: TicketJobContext | null = null;

/** The app attaches its deps, sockets and logger here, so the job (built first) can announce. */
export function attachTicketJobs(ctx: TicketJobContext | null): void {
  attached = ctx;
}

/** Job handlers of the tickets module; passed to `startJobs`. */
export function ticketsJobHandlers(): JobHandlers {
  return {
    // Idempotent: a resolved ticket is never selected again. A run before the app is attached
    // fails, so the framework records it; the next hourly run takes the tickets.
    [AUTO_RESOLVE_JOB]: async () => {
      if (!attached) throw new Error(`${AUTO_RESOLVE_JOB}: the app is not attached yet`);
      await autoResolveDue(attached, new Date());
    },
  };
}

/** Hourly at :15 Bratislava time. */
export const ticketsSchedules: JobSchedule[] = [
  { name: AUTO_RESOLVE_JOB, cron: '15 * * * *', tz: 'Europe/Bratislava' },
];
