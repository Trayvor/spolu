import { performance } from 'node:perf_hooks';
import {
  AI_DESCRIPTION_MAX,
  AI_MAX_TASKS,
  AI_TITLE_MAX,
  MENTION_RE,
  type TaskProposal,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../infra/db/client.js';
import type { MessageRow } from '../chat/dto.js';
import { getMessage, getMessageFiles } from '../chat/messages.js';
import type { ChannelRow } from '../chat/service.js';
import { listPickablePeople } from '../groups/service.js';
import { ticketFiles, type TicketRow } from '../tickets/service.js';
import { getUserById } from '../users/service.js';
import {
  AiFailedError,
  AiTimeoutError,
  type RawTask,
  type SplitRequest,
  type SplitResult,
} from './provider.js';

/** One call to the AI may take this long; there is no retry. */
export const AI_TIMEOUT_MS = 30_000;
const ASSIGNEES_MAX = 10;

/** No provider is configured (route: 503 ai_unavailable). */
export class AiUnavailableError extends Error {
  constructor() {
    super('AI is not configured');
    this.name = 'AiUnavailableError';
  }
}

/** The AI answered, but no usable task is left (route: 422 ai_no_tasks). */
export class AiNoTasksError extends Error {
  constructor(readonly usage: SplitResult['usage']) {
    super('The AI proposed no tasks');
    this.name = 'AiNoTasksError';
  }
}

type Found = { message: MessageRow; channel: ChannelRow };

const bratislavaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bratislava',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Mention tokens as `@Name` (`@all` for everyone); newlines stay. */
async function withNames(db: Db, body: string, nameById: Map<string, string>): Promise<string> {
  const missing = [...body.matchAll(MENTION_RE)]
    .map((m) => m[1]!)
    .filter((id) => id !== 'all' && !nameById.has(id));
  // Someone mentioned who has since left the group: rare, so one lookup each.
  for (const id of new Set(missing)) {
    const row = await getUserById(db, id);
    if (row) nameById.set(id, row.name);
  }
  return body.replace(MENTION_RE, (_, id: string) =>
    id === 'all' ? '@all' : `@${nameById.get(id) ?? '?'}`,
  );
}

/** What the AI gets for a message: text, quoted parent, file names, pickable group people (clients and managers), today. */
export async function buildSplitRequest(
  db: Db,
  found: Found,
  now: Date = new Date(),
): Promise<SplitRequest> {
  const { message, channel } = found;
  const [people, files, replyTo] = await Promise.all([
    listPickablePeople(db, channel.groupId),
    getMessageFiles(db, channel.groupId, message.id),
    message.replyToId === null ? null : getMessage(db, message.replyToId),
  ]);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const quoted = replyTo && replyTo.deletedAt === null ? replyTo.body : null;
  return {
    text: await withNames(db, message.body, nameById),
    quoted: quoted === null ? null : await withNames(db, quoted, nameById),
    files: files.map((f) => ({ id: f.id, name: f.name })),
    people: people.map((p) => ({ id: p.id, name: p.name })),
    today: bratislavaDate.format(now),
  };
}

/** A file link's name for the AI: its last path segment, or its host (never the query). */
export function linkName(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).at(-1);
    if (!last) return parsed.hostname;
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return url;
  }
}

/**
 * What the AI gets for a ticket (part 21.5): its subject, area, programme, due date, the names of
 * its file links and its text as one labelled message; the files uploaded with it; the group's
 * pickable people; today. The ticket must have a client.
 */
export async function buildTicketSplitRequest(
  db: Db,
  ticket: TicketRow,
  now: Date = new Date(),
): Promise<SplitRequest> {
  const groupId = ticket.groupId!;
  const [people, files] = await Promise.all([
    listPickablePeople(db, groupId),
    ticketFiles(db, ticket),
  ]);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const line = (label: string, value: string | null) =>
    value === null || value.trim() === '' ? [] : [`${label}: ${value}`];
  const text = [
    `Support ticket #${ticket.number}`,
    ...line('Subject', ticket.subject),
    ...line('Area', ticket.area),
    ...line('Programme', ticket.programme),
    ...line('Due date', ticket.dueDate),
    ...line('Links to files', ticket.fileLinks.map(linkName).join(', ')),
    ...(ticket.body ? ['', await withNames(db, ticket.body, nameById)] : []),
  ].join('\n');
  return {
    text,
    quoted: null,
    files: files.map((f) => ({ id: f.id, name: f.name })),
    people: people.map((p) => ({ id: p.id, name: p.name })),
    today: bratislavaDate.format(now),
  };
}

const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** The first `max` code points (never half of a surrogate pair). */
const cut = (text: string, max: number): string => Array.from(text).slice(0, max).join('');

const allowedIds = (ids: string[], allowed: Set<string>) =>
  [...new Set(ids)].filter((id) => allowed.has(id));

/**
 * Makes the AI's cards safe to show: trimmed and cut titles and descriptions, no blank titles,
 * only the group's people and the message's files (deduplicated), real dates only, at most 10.
 */
export function sanitizeProposals(
  raw: RawTask[],
  allowed: { peopleIds: Set<string>; fileIds: Set<string> },
): TaskProposal[] {
  const out: TaskProposal[] = [];
  for (const task of raw) {
    const title = cut(task.title.trim(), AI_TITLE_MAX).trim();
    if (title === '') continue;
    out.push({
      title,
      description: cut(task.description.trim(), AI_DESCRIPTION_MAX),
      assigneeIds: allowedIds(task.assigneeIds, allowed.peopleIds).slice(0, ASSIGNEES_MAX),
      dueDate: task.deadline !== null && isCalendarDate(task.deadline) ? task.deadline : null,
      urgent: task.urgent,
      messageFileIds: allowedIds(task.fileIds, allowed.fileIds),
    });
    if (out.length === AI_MAX_TASKS) break;
  }
  return out;
}

/**
 * Asks the provider for task cards for a readable message and sanitizes them; see `askProvider`.
 */
export async function proposeTasks(
  deps: AppDeps,
  found: Found,
  options: { timeoutMs?: number } = {},
): Promise<Proposed> {
  if (deps.ai === null) throw new AiUnavailableError();
  return askProvider(deps, await buildSplitRequest(deps.db, found), options);
}

/**
 * Task cards for a ticket with a client (part 21.5). A card without a deadline of its own gets
 * the ticket's due date.
 */
export async function proposeTicketTasks(
  deps: AppDeps,
  ticket: TicketRow,
  options: { timeoutMs?: number } = {},
): Promise<Proposed> {
  if (deps.ai === null) throw new AiUnavailableError();
  const result = await askProvider(deps, await buildTicketSplitRequest(deps.db, ticket), options);
  return {
    ...result,
    tasks: result.tasks.map((t) => ({ ...t, dueDate: t.dueDate ?? ticket.dueDate })),
  };
}

export type Proposed = { tasks: TaskProposal[]; usage: SplitResult['usage']; durationMs: number };

/**
 * Sends the request to the provider and sanitizes the answer. The provider gets an abort signal
 * and `timeoutMs`; a provider that ignores it is still cut off then.
 */
async function askProvider(
  deps: AppDeps,
  request: SplitRequest,
  options: { timeoutMs?: number },
): Promise<Proposed> {
  const provider = deps.ai;
  if (provider === null) throw new AiUnavailableError();

  const signal = AbortSignal.timeout(options.timeoutMs ?? AI_TIMEOUT_MS);
  const timedOut = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new AiTimeoutError()), { once: true });
  });
  const started = performance.now();
  let result: SplitResult;
  try {
    result = await Promise.race([provider.split(request, signal), timedOut]);
  } catch (error) {
    if (signal.aborted) throw new AiTimeoutError();
    if (error instanceof AiFailedError) throw error;
    throw new AiFailedError('AI provider failed', { cause: error });
  }
  const durationMs = Math.round(performance.now() - started);

  const tasks = sanitizeProposals(result.tasks, {
    peopleIds: new Set(request.people.map((p) => p.id)),
    fileIds: new Set(request.files.map((f) => f.id)),
  });
  if (tasks.length === 0) throw new AiNoTasksError(result.usage);
  return { tasks, usage: result.usage, durationMs };
}
