import type { FastifyBaseLogger } from 'fastify';
import type { AppDeps } from '../../deps.js';
import type { TicketRow } from './service.js';

/**
 * A committed change of a ticket. Later parts react to it without the tickets module knowing
 * them: the ticket chat (21.3) creates or moves its channel, notifications (21.6) tell the
 * followers. `previousGroupId` is set on `moved`, `count` on `tasks`.
 */
export type TicketChange = {
  kind: 'created' | 'status' | 'updated' | 'moved' | 'tasks';
  ticket: TicketRow;
  actorId: string | null;
  previousGroupId?: string | null;
  /** On `tasks`: how many tasks the ticket was turned into (part 21.5). */
  count?: number;
};

type TicketChangeHook = (deps: AppDeps, change: TicketChange) => Promise<void>;
const hooks: TicketChangeHook[] = [];

/** Registers a reaction to ticket changes; called once per hook at start-up. */
export function onTicketChange(hook: TicketChangeHook): void {
  if (!hooks.includes(hook)) hooks.push(hook);
}

/** Runs every hook after the write committed; a failing hook is logged, never undoes the write. */
export async function runTicketChange(
  deps: AppDeps,
  change: TicketChange,
  log: FastifyBaseLogger,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(deps, change);
    } catch (error) {
      log.error(
        { err: error, ticketId: change.ticket.id, kind: change.kind },
        'ticket hook failed',
      );
    }
  }
}
