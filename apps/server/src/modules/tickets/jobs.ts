import { and, asc, eq, isNotNull, lte, notInArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import { TICKET_CONFIRM_DAYS } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { JobHandlers, JobSchedule } from '../../infra/jobs/jobs.js';
import { systemActor } from '../audit/actor.js';
import { emitTicket } from './events.js';
import { runTicketChange } from './hooks.js';
import { tickets } from './schema.js';
import { updateTicket, type TicketRow } from './service.js';

/** Resolves the tickets whose "solved on our side" mark is five days old (design 5.3). */
export const AUTO_RESOLVE_JOB = 'tickets.auto-resolve';

const BATCH = 100;

/** What the job needs after a commit: the app's deps, its sockets and its logger. */
export type TicketJobContext = { deps: AppDeps; io: SocketIOServer; log: FastifyBaseLogger };

/**
 * Resolves every ticket marked "solved on our side" at or before `now` minus five days, and says
 * how many it resolved. Each ticket has its own transaction: the row is locked with
 * `for update skip locked` (a decline or a message holding it makes the job skip it until the next
 * run), the mark is checked again on the locked row, and `updateTicket` writes inside that
 * transaction as the system (no actor: no time dialog, `ticket.resolved` goes to the full
 * audience). A ticket that fails is logged and left for the next run without stopping the others.
 * The announcement (socket event, hooks) follows each commit. The author is not looked at: one who
 * lost access does not keep the ticket open. Ends when a pass resolves nothing.
 */
export async function autoResolveDue(ctx: TicketJobContext, now: Date): Promise<number> {
  const { db } = ctx.deps;
  const cutoff = new Date(now.getTime() - TICKET_CONFIRM_DAYS * 86_400_000);
  const due = and(
    eq(tickets.status, 'in_progress'),
    isNotNull(tickets.adminDoneAt),
    lte(tickets.adminDoneAt, cutoff),
  );
  const by = systemActor(AUTO_RESOLVE_JOB);
  const tried: string[] = [];
  let resolved = 0;
  for (;;) {
    const ids = (
      await db
        .select({ id: tickets.id })
        .from(tickets)
        .where(tried.length ? and(due, notInArray(tickets.id, tried)) : due)
        .orderBy(asc(tickets.adminDoneAt))
        .limit(BATCH)
    ).map((r) => r.id);
    if (ids.length === 0) return resolved;
    let progress = 0;
    for (const id of ids) {
      tried.push(id);
      try {
        const done = await db.transaction(async (tx): Promise<TicketRow | null> => {
          const [locked] = await tx
            .select()
            .from(tickets)
            .where(and(eq(tickets.id, id), due))
            .for('update', { skipLocked: true });
          if (!locked?.adminDoneAt || locked.adminDoneAt > cutoff) return null;
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
        progress += 1;
        resolved += 1;
        emitTicket(ctx.io, 'updated', done);
        await runTicketChange(ctx.deps, { kind: 'status', ticket: done, actorId: null }, ctx.log);
      } catch (error) {
        ctx.log.error({ err: error, ticketId: id }, 'ticket auto-resolve failed');
      }
    }
    if (progress === 0) return resolved;
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
    // Idempotent: a resolved ticket is never selected again; a run before the app is up does
    // nothing and the next hour takes the ticket.
    [AUTO_RESOLVE_JOB]: async () => {
      if (attached) await autoResolveDue(attached, new Date());
    },
  };
}

/** Hourly at :15 Bratislava time. */
export const ticketsSchedules: JobSchedule[] = [
  { name: AUTO_RESOLVE_JOB, cron: '15 * * * *', tz: 'Europe/Bratislava' },
];
