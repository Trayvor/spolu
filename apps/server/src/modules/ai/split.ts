import { performance } from 'node:perf_hooks';
import {
  AI_DESCRIPTION_MAX,
  AI_MAX_TASKS,
  AI_TITLE_MAX,
  isHttpUrl,
  MENTION_RE,
  mentionToken,
  type FileInfo,
  type GroupPerson,
  type TaskProposal,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../infra/db/client.js';
import type { MessageRow } from '../chat/dto.js';
import { getMessage, getMessageFiles, listRecentMessages } from '../chat/messages.js';
import { getTicketChannel, type ChannelRow } from '../chat/service.js';
import { listPickablePeople } from '../groups/service.js';
import { listActiveProjectNames } from '../projects/refs.js';
import { ticketTaskFiles, type TicketRow } from '../tickets/service.js';
import { getUserById } from '../users/service.js';
import {
  AiFailedError,
  AiTimeoutError,
  type RawTask,
  type SplitRequest,
  type SplitResult,
} from './provider.js';

/** One call to the AI may take this long; there is no retry. */
const AI_TIMEOUT_MS = 30_000;
const ASSIGNEES_MAX = 10;
/** The most active projects the AI gets (by name); a client rarely has more than a few dozen. */
export const PROJECTS_MAX = 100;

/** A pickable person as the AI sees them: an admin is the eGrant team, anyone else the client. */
const personOf = (p: GroupPerson): SplitRequest['people'][number] => ({
  id: p.id,
  name: p.name,
  team: p.isAdmin ? 'egrant' : 'client',
});

const activeProjects = (db: Db, groupId: string) =>
  listActiveProjectNames(db, groupId, PROJECTS_MAX);

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

/** The first `max` code points (never half of a surrogate pair). */
const cut = (text: string, max: number): string => Array.from(text).slice(0, max).join('');

/** Mention tokens as `@Name` (`@all` for everyone); newlines stay. */
export async function withNames(
  db: Db,
  body: string,
  nameById: Map<string, string>,
): Promise<string> {
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

/** The people `bodies` mention (not `@all`), by the names `withNames` gave them. */
function mentionsOf(bodies: string[], nameById: Map<string, string>) {
  const ids = new Set(bodies.flatMap((b) => [...b.matchAll(MENTION_RE)].map((m) => m[1]!)));
  return [...ids].flatMap((id) => {
    const name = nameById.get(id);
    return id === 'all' || name === undefined ? [] : [{ id, name }];
  });
}

/**
 * What the AI gets for a message: text, quoted parent, file names, pickable group people (clients
 * and managers, each marked eGrant team or client), the client's active projects, today.
 */
export async function buildSplitRequest(
  db: Db,
  found: Found,
  now: Date = new Date(),
): Promise<SplitRequest> {
  const { message, channel } = found;
  const [people, files, replyTo, projects] = await Promise.all([
    listPickablePeople(db, channel.groupId),
    getMessageFiles(db, channel.groupId, message.id),
    message.replyToId === null ? null : getMessage(db, message.replyToId),
    activeProjects(db, channel.groupId),
  ]);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const quoted = replyTo && replyTo.deletedAt === null ? replyTo.body : null;
  return {
    source: 'message',
    details: [],
    conversation: [],
    text: await withNames(db, message.body, nameById),
    quoted: quoted === null ? null : await withNames(db, quoted, nameById),
    files: files.map((f) => ({ id: f.id, name: f.name })),
    people: people.map(personOf),
    projects,
    today: bratislavaDate.format(now),
    mentions: mentionsOf([message.body, quoted ?? ''], nameById),
  };
}

/**
 * What the AI gets for a text pasted on a board: the text, the group's pickable people, its active
 * projects, today. No files and no mentions (the text is plain).
 */
export async function buildTextSplitRequest(
  db: Db,
  groupId: string,
  text: string,
  now: Date = new Date(),
): Promise<SplitRequest> {
  const [people, projects] = await Promise.all([
    listPickablePeople(db, groupId),
    activeProjects(db, groupId),
  ]);
  return {
    source: 'message',
    details: [],
    conversation: [],
    text,
    quoted: null,
    files: [],
    people: people.map(personOf),
    projects,
    today: bratislavaDate.format(now),
    mentions: [],
  };
}

/** The newest ticket chat messages the AI gets, and the length each is cut to. */
const CONVERSATION_MAX = 30;
const CONVERSATION_MESSAGE_MAX = 2000;

/**
 * What the AI gets for a ticket (part 21.5): its subject and text; its area and programme as
 * context only; its chat, oldest first (the newest `CONVERSATION_MAX` messages); its files
 * (uploaded with it, sent to the intake or sent in its chat: `ticketTaskFiles`); the group's
 * pickable people; the client's active projects unless the ticket has a project (then that is
 * every card's project and the AI does not choose); today. No number, dates or labels
 * in the text: the AI copied them into the cards. The ticket must have a client.
 */
export async function buildTicketSplitRequest(
  db: Db,
  ticket: TicketRow,
  now: Date = new Date(),
): Promise<SplitRequest> {
  const groupId = ticket.groupId!;
  const [people, files, channel, projects] = await Promise.all([
    listPickablePeople(db, groupId),
    ticketTaskFiles(db, ticket),
    getTicketChannel(db, ticket.id),
    ticket.projectId === null ? activeProjects(db, groupId) : [],
  ]);
  const messages = channel ? await listRecentMessages(db, channel.id, CONVERSATION_MAX) : [];
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const filled = (value: string | null): value is string => value !== null && value.trim() !== '';
  const body = filled(ticket.body) ? await withNames(db, ticket.body, nameById) : null;
  const detail = (label: string, value: string | null) =>
    filled(value) ? [{ label, value: value.trim() }] : [];
  const conversation = [];
  for (const m of messages) {
    const text = cut((await withNames(db, m.body, nameById)).trim(), CONVERSATION_MESSAGE_MAX);
    if (text !== '') conversation.push({ author: m.authorName, text });
  }
  return {
    source: 'ticket',
    text: [ticket.subject, body].filter(filled).join('\n\n'),
    quoted: null,
    files: files.map((f) => ({ id: f.id, name: f.name })),
    people: people.map(personOf),
    projects,
    today: bratislavaDate.format(now),
    details: [...detail('Area', ticket.area), ...detail('Programme', ticket.programme)],
    conversation,
    mentions: mentionsOf([ticket.body ?? '', ...messages.map((m) => m.body)], nameById),
  };
}

const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const allowedIds = (ids: string[], allowed: Set<string>) =>
  [...new Set(ids)].filter((id) => allowed.has(id));

/** A web address in a text: http(s), up to a space, a quote or a bracket (Markdown's too). */
const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/gu;

/** The web addresses of `texts`, in order, without repeats and without trailing punctuation. */
function urlsIn(...texts: string[]): string[] {
  const found = texts.flatMap((t) =>
    [...t.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:!?]+$/u, '')),
  );
  return [...new Set(found)].filter(isHttpUrl);
}

/**
 * Makes the AI's cards safe to show: trimmed and cut titles and descriptions, no blank titles,
 * only the group's people and the message's files (deduplicated), real dates only, a link only
 * when the source's texts have it (`urls`), a project only when it was offered (`projectIds`),
 * at most 10.
 */
export function sanitizeProposals(
  raw: RawTask[],
  allowed: {
    peopleIds: Set<string>;
    fileIds: Set<string>;
    urls?: Set<string>;
    projectIds?: Set<string>;
  },
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
      link: task.link && allowed.urls?.has(task.link.trim()) ? task.link.trim() : null,
      projectId: task.projectId && allowed.projectIds?.has(task.projectId) ? task.projectId : null,
    });
    if (out.length === AI_MAX_TASKS) break;
  }
  return out;
}

/**
 * The link of a card the AI gave none (owner request 2026-10-22): `fallback` (a ticket's own URL),
 * else the one web address of its description, else, when it is the only card, the one web
 * address of the source text. Only addresses of the source (`allowed`) count, and a text with
 * two or more addresses gives none: which one is meant is the reviewer's call.
 */
function fillLinks(
  tasks: TaskProposal[],
  sourceText: string,
  allowed: Set<string>,
  fallback: string | null,
): TaskProposal[] {
  const onlyUrl = (text: string) => {
    const urls = urlsIn(text);
    return urls.length === 1 && allowed.has(urls[0]!) ? urls[0]! : null;
  };
  return tasks.map((t) => ({
    ...t,
    link:
      t.link ??
      fallback ??
      onlyUrl(t.description) ??
      (tasks.length === 1 ? onlyUrl(sourceText) : null),
  }));
}

/**
 * A web address of the source text that no card carries (in its description or as its link) is
 * added at the end of every card's description, on its own line: the AI must not lose a link
 * (owner bug report 2026-10-18), and which card it belongs to is the reviewer's call.
 */
function keepUrls(tasks: TaskProposal[], urls: string[]): TaskProposal[] {
  const carried = (url: string) => tasks.some((t) => t.link === url || t.description.includes(url));
  const missing = urls.filter((url) => !carried(url));
  if (missing.length === 0) return tasks;
  const suffix = missing.join('\n');
  const room = AI_DESCRIPTION_MAX - suffix.length - 2;
  if (room < 0) return tasks;
  return tasks.map((t) => {
    const text = cut(t.description, room).trimEnd();
    return { ...t, description: text === '' ? suffix : `${text}\n\n${suffix}` };
  });
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * "@Name" in a card's description becomes a mention again for each person the source mentioned
 * (the AI sees names, never mention tokens). A name two of them share stays text; a longer name
 * goes first, and "@Ana" never matches the start of "@Anabela".
 */
function restoreMentions(
  tasks: TaskProposal[],
  mentions: { id: string; name: string }[],
): TaskProposal[] {
  const count = new Map<string, number>();
  for (const m of mentions) count.set(m.name, (count.get(m.name) ?? 0) + 1);
  const unique = mentions
    .filter((m) => m.name.trim() !== '' && count.get(m.name) === 1)
    .sort((a, b) => b.name.length - a.name.length)
    .map((m) => ({
      id: m.id,
      re: new RegExp(`@${escapeRegExp(m.name)}(?![\\p{L}\\p{N}_-])`, 'gu'),
    }));
  if (unique.length === 0) return tasks;
  return tasks.map((t) => ({
    ...t,
    description: unique.reduce(
      (text, m) => text.replace(m.re, () => mentionToken(m.id)),
      t.description,
    ),
  }));
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

/** Task cards for a text pasted on the board of `groupId` (the route checked access). */
export async function proposeTextTasks(
  deps: AppDeps,
  groupId: string,
  text: string,
  options: { timeoutMs?: number } = {},
): Promise<Proposed> {
  if (deps.ai === null) throw new AiUnavailableError();
  return askProvider(deps, await buildTextSplitRequest(deps.db, groupId, text), options);
}

/**
 * Task cards for a ticket with a client (part 21.5). A card without a deadline of its own gets
 * the ticket's due date, one without a link the ticket's URL; a ticket's project is every card's
 * project (the AI chooses only for a ticket without one); `files` are the files the cards may
 * copy (`ticketTaskFiles`).
 */
export async function proposeTicketTasks(
  deps: AppDeps,
  ticket: TicketRow,
  options: { timeoutMs?: number } = {},
): Promise<Proposed> {
  if (deps.ai === null) throw new AiUnavailableError();
  const [request, files] = await Promise.all([
    buildTicketSplitRequest(deps.db, ticket),
    ticketTaskFiles(deps.db, ticket),
  ]);
  const url = ticket.url?.trim() ?? '';
  const result = await askProvider(deps, request, options, isHttpUrl(url) ? url : null);
  return {
    ...result,
    tasks: result.tasks.map((t) => ({
      ...t,
      dueDate: t.dueDate ?? ticket.dueDate,
      projectId: ticket.projectId ?? t.projectId,
    })),
    files,
  };
}

export type Proposed = {
  tasks: TaskProposal[];
  usage: SplitResult['usage'];
  durationMs: number;
  /** The source's files the cards may copy, when the screen does not have them all (a ticket). */
  files?: FileInfo[];
};

/**
 * Sends the request to the provider and sanitizes the answer. The provider gets an abort signal
 * and `timeoutMs`; a provider that ignores it is still cut off then.
 */
async function askProvider(
  deps: AppDeps,
  request: SplitRequest,
  options: { timeoutMs?: number },
  /** A ticket's own URL: the link of every card the AI gave none. */
  fallbackLink: string | null = null,
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

  const urls = new Set(
    urlsIn(request.text, request.quoted ?? '', ...request.conversation.map((m) => m.text)),
  );
  const sanitized = sanitizeProposals(result.tasks, {
    peopleIds: new Set(request.people.map((p) => p.id)),
    fileIds: new Set(request.files.map((f) => f.id)),
    urls,
    projectIds: new Set(request.projects.map((p) => p.id)),
  });
  if (sanitized.length === 0) throw new AiNoTasksError(result.usage);
  // The text's own links must reach the cards; the quote and the ticket chat are context.
  const tasks = keepUrls(
    restoreMentions(fillLinks(sanitized, request.text, urls, fallbackLink), request.mentions ?? []),
    urlsIn(request.text),
  );
  return { tasks, usage: result.usage, durationMs };
}
