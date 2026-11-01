import { HOME_LIMITS, type HomeUnseen, type HomeUnseenItem } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { unseenSummaries } from '../notifications/unseen.js';
import { listUnseenTasks } from '../tasks/service.js';
import { listUnseenTickets } from '../tickets/dashboard.js';

/**
 * The dashboard's Unseen card (owner, 2026-11-01): every task and ticket with a change the
 * viewer has not seen, the same sets as the header counts (so the card's numbers equal them),
 * newest change first, the first `HOME_LIMITS.unseen`. Three statements: the tasks and the
 * tickets (each its first page and its total) in parallel, then the summaries of the page in one
 * batch. Admins only (the route checks it); admins read every ticket, so no further filter.
 */
export async function getUnseen(db: Db, userId: string): Promise<HomeUnseen> {
  const limit = HOME_LIMITS.unseen;
  const [tasks, tickets] = await Promise.all([
    listUnseenTasks(db, userId, limit),
    listUnseenTickets(db, userId, limit),
  ]);
  const page = [
    ...tasks.items.map((t) => ({ kind: 'task' as const, ticketNumber: null, ...t })),
    ...tickets.items.map(({ number, ...t }) => ({
      kind: 'ticket' as const,
      ticketNumber: number,
      ...t,
    })),
  ]
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime() || (a.id < b.id ? 1 : -1))
    .slice(0, limit);
  const summaries = await unseenSummaries(db, userId, {
    taskIds: page.filter((i) => i.kind === 'task').map((i) => i.id),
    ticketIds: page.filter((i) => i.kind === 'ticket').map((i) => i.id),
  });
  const items: HomeUnseenItem[] = page.map((i) => ({
    kind: i.kind,
    id: i.id,
    ticketNumber: i.ticketNumber,
    title: i.title,
    groupId: i.groupId,
    groupName: i.groupName,
    changedAt: i.lastAt.toISOString(),
    unseen: i.message ? 'message' : 'change',
    summary: summaries.get(`${i.kind}:${i.id}`) ?? { lines: [], more: 0 },
  }));
  return { tasks: tasks.total, tickets: tickets.total, items };
}
