import type { BucketDto, TicketStatus, UserLanguage } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { listRecentMessages, messageFileNames } from '../chat/messages.js';
import { getTaskChannel, getTicketChannel, type ChannelRow } from '../chat/service.js';
import { normalizeEgrantUrl } from '../groups/egrant-url.js';
import { getGroup, listPickablePeople } from '../groups/service.js';
import { getTask } from '../tasks/task-service.js';
import { getBucket } from '../tasks/service.js';
import { assigneesOf, ticketFiles, type TicketRow } from '../tickets/service.js';
import { buildClaudePrompt, formatPromptTime, type PromptMessage } from './claude-prompt.js';
import { withNames } from './split.js';

/**
 * Gathers a ticket's or task's context for "Otvoriť v Claude" (Phase 29) through the owning
 * modules' service functions and builds the prompt. The caller checks `canOpenInClaude`.
 */

/** The newest chat messages the prompt carries. */
export const PROMPT_MESSAGES_MAX = 30;

type Field = { label: string; value: string };
type PromptFile = { id: string; name: string };
type Options = {
  publicUrl: string;
  language: UserLanguage;
  notes: string;
  generatedBy: { name: string; email: string; role: string };
  generatedAt: Date;
};
/** The prompt and every file it names, the item's own first, each once. */
export type ClaudePromptResult = { prompt: string; files: PromptFile[] };

const unique = (files: PromptFile[]): PromptFile[] => [
  ...new Map(files.map((f) => [f.id, { id: f.id, name: f.name }])).values(),
];
const field = (label: string, value: string | null | undefined): Field[] =>
  value !== null && value !== undefined && value.trim() !== ''
    ? [{ label, value: value.trim() }]
    : [];

const STATUS: Record<TicketStatus, string> = {
  new: 'Nový',
  in_progress: 'V riešení',
  resolved: 'Vyriešený',
};

function bucketLabel(bucket: BucketDto | null, groupName: string): string | null {
  if (bucket === null) return null;
  switch (bucket.kind) {
    case 'todo':
      return 'Na spracovanie';
    case 'egrant_review':
      return 'Kontroluje eGrant';
    case 'client_review':
      return `Kontroluje ${groupName}`;
    case 'done':
      return 'Hotové';
    case 'custom':
      return bucket.name;
  }
}

/** The newest messages of a chat, oldest first, with mention names and file names. */
async function chatMessages(
  db: Db,
  channel: ChannelRow | null,
  nameById: Map<string, string>,
): Promise<{ messages: PromptMessage[]; olderOmitted: boolean; files: PromptFile[] }> {
  if (channel === null) return { messages: [], olderOmitted: false, files: [] };
  const rows = await listRecentMessages(db, channel.id, PROMPT_MESSAGES_MAX + 1);
  const olderOmitted = rows.length > PROMPT_MESSAGES_MAX;
  const shown = olderOmitted ? rows.slice(1) : rows;
  const files = await messageFileNames(
    db,
    channel.groupId,
    shown.map((m) => m.id),
  );
  const messages: PromptMessage[] = [];
  const attached: PromptFile[] = [];
  for (const m of shown) {
    const text = (await withNames(db, m.body, nameById)).trim();
    const own = files.get(m.id) ?? [];
    if (text === '' && own.length === 0) continue;
    messages.push({ at: m.createdAt, author: m.authorName, text, files: own.map((f) => f.name) });
    attached.push(...own);
  }
  return { messages, olderOmitted, files: attached };
}

async function peopleNames(db: Db, groupId: string | null): Promise<Map<string, string>> {
  if (groupId === null) return new Map();
  return new Map((await listPickablePeople(db, groupId)).map((p) => [p.id, p.name]));
}

export async function ticketClaudePrompt(
  db: Db,
  ticket: TicketRow,
  options: Options,
): Promise<ClaudePromptResult> {
  const [group, assignees, files, channel, nameById] = await Promise.all([
    ticket.groupId === null ? null : getGroup(db, ticket.groupId),
    assigneesOf(db, [ticket.id]),
    ticketFiles(db, ticket),
    getTicketChannel(db, ticket.id),
    peopleNames(db, ticket.groupId),
  ]);
  const [chat, body] = await Promise.all([
    chatMessages(db, channel, nameById),
    ticket.body === null ? null : withNames(db, ticket.body, nameById),
  ]);
  const requester =
    ticket.requesterName !== null && ticket.requesterEmail !== null
      ? `${ticket.requesterName} <${ticket.requesterEmail}>`
      : (ticket.requesterName ?? ticket.requesterEmail);
  const instanceUrl =
    (ticket.instanceUrl === null ? null : normalizeEgrantUrl(ticket.instanceUrl)) ??
    group?.egrantUrl ??
    null;
  const subject = ticket.subject?.trim();
  const prompt = buildClaudePrompt({
    kind: 'ticket',
    heading: `Tiket #${ticket.number}${subject ? `: ${subject}` : ''}`,
    link: `${options.publicUrl}/tickets/${ticket.id}`,
    fields: [
      ...field('Stav', STATUS[ticket.status]),
      ...field('Klient', group?.name ?? 'bez klienta'),
      ...field('Oblasť', ticket.area),
      ...field('Program', ticket.programme),
      ...field('Termín', ticket.dueDate),
      ...field('Riešitelia', (assignees.get(ticket.id) ?? []).map((p) => p.name).join(', ')),
      ...field('Žiadateľ', requester),
      ...field('Stránka, ktorej sa tiket týka', ticket.url),
      ...field('Vytvorený', formatPromptTime(ticket.createdAt)),
    ],
    text: body,
    files: files.map((f) => f.name),
    messages: chat.messages,
    olderOmitted: chat.olderOmitted,
    instanceUrl,
    notes: options.notes,
    language: options.language,
    generatedBy: options.generatedBy,
    generatedAt: options.generatedAt,
  });
  return { prompt, files: unique([...files, ...chat.files]) };
}

/** The task's prompt, or null when the task does not exist. */
export async function taskClaudePrompt(
  db: Db,
  taskId: string,
  options: Options,
): Promise<ClaudePromptResult | null> {
  const task = await getTask(db, taskId);
  if (task === null) return null;
  const [group, bucket, channel, nameById] = await Promise.all([
    getGroup(db, task.groupId),
    getBucket(db, task.bucketId),
    getTaskChannel(db, task.id),
    peopleNames(db, task.groupId),
  ]);
  const groupName = group?.name ?? '';
  const [chat, description] = await Promise.all([
    chatMessages(db, channel, nameById),
    withNames(db, task.description, nameById),
  ]);
  const source = task.sourceTicket;
  const prompt = buildClaudePrompt({
    kind: 'task',
    heading: `Úloha: ${task.title}`,
    link: `${options.publicUrl}/groups/${task.groupId}/tasks/${task.id}`,
    fields: [
      ...field('Stĺpec', bucketLabel(bucket, groupName)),
      ...field('Klient', groupName),
      ...field('Urgentná', task.urgent ? 'áno' : null),
      ...field('Termín', task.dueDate),
      ...field('Riešitelia', task.assignees.map((p) => p.name).join(', ')),
      ...field('Odkaz', task.link),
      ...field(
        'Vznikla z tiketu',
        source === null
          ? null
          : `#${source.number}${source.subject ? ` ${source.subject}` : ''} (${options.publicUrl}/tickets/${source.id})`,
      ),
      ...field('Vytvoril', task.createdBy.name),
      ...field('Vytvorená', formatPromptTime(new Date(task.createdAt))),
    ],
    text: description,
    files: task.files.map((f) => f.name),
    messages: chat.messages,
    olderOmitted: chat.olderOmitted,
    instanceUrl: group?.egrantUrl ?? null,
    notes: options.notes,
    language: options.language,
    generatedBy: options.generatedBy,
    generatedAt: options.generatedAt,
  });
  return { prompt, files: unique([...task.files, ...chat.files]) };
}
