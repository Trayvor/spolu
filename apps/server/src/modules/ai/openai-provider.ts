import { z } from 'zod';
import { AI_DESCRIPTION_MAX, AI_MAX_TASKS, AI_TITLE_MAX } from '@spolu/shared';
import { AiFailedError, type SplitRequest, type TaskSplitProvider } from './provider.js';

const MAX_COMPLETION_TOKENS = 8000;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/** How a card is written, for a message and for a ticket alike. */
const CARD_RULES = [
  'Make one task per distinct job; do not split one job into steps.',
  'A title is a short action (at most 200 characters, best under 80), such as "Fix the error 500 on the Applications tab"; never add a ticket number, a source, a status or a date to it.',
  'A description says only what has to be done, clearly and concretely, with the details the text gives (at most 5000 characters). Never add labelled metadata lines (number, subject, area, programme, files, dates, reporter), and never generic advice or a standard procedure (such as checking logs, reproducing the problem, testing or preparing a fix) that the text does not ask for.',
  "Keep every web address (URL) the text gives for a job in that task's description, copied exactly; never shorten, change or drop one. Set link to the one web address that shows where the problem is or what the task is about, copied exactly from the text, or null when the text has none.",
  'Only when the text gives useful context beyond the job itself (what was already tried, where or when it happens, an answer or a decision from the conversation), end the description with a short paragraph headed "Notes:" in the output language; otherwise add no notes.',
  'Set assigneeIds to the people the text gives the job to: a person of the People list named by full name, first name, surname, a short or familiar form of the name (such as "Zuzka" for Zuzana or "Peťo" for Peter) or an @mention. Each person is marked eGrant team or client: when the text gives the job to a side ("eGrant should…", "the support team", "the client will send…") and exactly one listed person is on that side, assign them. When a name fits more than one person equally, or nothing in the text points at anyone, use []: never guess.',
  'Set deadline (YYYY-MM-DD) and urgent only when the text states them clearly; otherwise use null and false.',
  'Set projectId to the id of the one project of the Projects list the text clearly refers to: by its name, a close variant of it (an abbreviation, another word order or case, missing diacritics) or unmistakable context; otherwise null. Never choose a project only because it is the only one listed.',
  'Use only ids from the lists given. Give each file to the task or tasks it belongs to (fileIds); a file may belong to several tasks or to none.',
  'Return at most 10 tasks, or none if the text describes no job.',
].join(' ');

/** The system prompt by source: one chat message, or a support ticket with its chat. */
export const SYSTEM_PROMPTS = {
  message: `You turn one chat message into task cards for a project board. Write every title and description in the language of the message. ${CARD_RULES}`,
  ticket: `You turn a support ticket into task cards for the support team's board. You get the ticket (its subject and text), some details for context only, and the ticket's chat, oldest first: later messages may correct, settle or add to what the ticket says. Describe the work from the ticket and its chat together. Write every title and description in the language of the ticket and its chat. ${CARD_RULES}`,
} as const;

const ids = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

/**
 * The structured-output schema. Strict mode needs every property required and no extra ones;
 * it cannot express lengths or counts, so those are in the descriptions and enforced by
 * `sanitizeProposals`.
 */
const TASK_SPLIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      description: `At most ${AI_MAX_TASKS} tasks; empty if the message describes no job.`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'description',
          'assigneeIds',
          'fileIds',
          'deadline',
          'urgent',
          'link',
          'projectId',
        ],
        properties: {
          title: { type: 'string', description: `At most ${AI_TITLE_MAX} characters.` },
          description: { type: 'string', description: `At most ${AI_DESCRIPTION_MAX} characters.` },
          assigneeIds: ids(
            'Ids from the People list the text gives the job to (by name, short name, @mention or side); [] when nothing points at anyone.',
          ),
          fileIds: ids('Ids from the Files list that belong to this task.'),
          deadline: {
            type: ['string', 'null'],
            description: 'YYYY-MM-DD, or null unless the message states a deadline clearly.',
          },
          urgent: { type: 'boolean', description: 'True only when the message says so clearly.' },
          link: {
            type: ['string', 'null'],
            description: 'A web address copied exactly from the text, or null.',
          },
          projectId: {
            type: ['string', 'null'],
            description: 'An id from the Projects list the text clearly refers to, or null.',
          },
        },
      },
    },
  },
} as const;

const RawTasksSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      assigneeIds: z.array(z.string()),
      fileIds: z.array(z.string()),
      deadline: z.string().nullable(),
      urgent: z.boolean(),
      link: z.string().nullish(),
      projectId: z.string().nullish(),
    }),
  ),
});

const CompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          refusal: z.string().nullish(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).nullish(),
});

const list = (items: { id: string; name: string }[]) =>
  items.length === 0 ? '(none)' : items.map((i) => `${i.id} — ${i.name}`).join('\n');

const SIDE = { egrant: 'eGrant team', client: 'client' } as const;

/** The user message: the request as labelled sections. */
export function renderSplitPrompt(request: SplitRequest): string {
  const ticket = request.source === 'ticket';
  return [
    `${ticket ? 'Ticket' : 'Message'}:\n${request.text}`,
    ...(request.quoted === null ? [] : [`Quoted message:\n${request.quoted}`]),
    ...(request.details.length === 0
      ? []
      : [
          `Details (context only, never copy them into a card):\n${request.details
            .map((d) => `${d.label}: ${d.value}`)
            .join('\n')}`,
        ]),
    ...(request.conversation.length === 0
      ? []
      : [
          `Ticket chat (oldest first):\n${request.conversation
            .map((m) => `${m.author}: ${m.text}`)
            .join('\n')}`,
        ]),
    `Files (id — name):\n${list(request.files)}`,
    `People (id — name, side):\n${
      request.people.length === 0
        ? '(none)'
        : request.people.map((p) => `${p.id} — ${p.name} (${SIDE[p.team]})`).join('\n')
    }`,
    `Projects (id — name):\n${list(request.projects)}`,
    `Today:\n${request.today}`,
  ].join('\n\n');
}

/** Chat Completions with a strict JSON schema, through `fetch` (no SDK). */
export function createOpenAiProvider(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): TaskSplitProvider {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async split(request, signal) {
      let payload: unknown;
      try {
        const response = await fetchImpl(OPENAI_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            // Ten full cards fit well within this; it caps the cost of a runaway answer.
            max_completion_tokens: MAX_COMPLETION_TOKENS,
            messages: [
              { role: 'system', content: SYSTEM_PROMPTS[request.source] },
              { role: 'user', content: renderSplitPrompt(request) },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'task_split', strict: true, schema: TASK_SPLIT_SCHEMA },
            },
          }),
          signal,
        });
        if (!response.ok) {
          // The error body is not read (an auth error echoes part of the key), only released.
          await response.body?.cancel();
          throw new AiFailedError(`OpenAI answered ${response.status}`);
        }
        payload = await response.json();
      } catch (error) {
        if (error instanceof AiFailedError) throw error;
        const name = error instanceof Error ? error.name : 'unknown';
        throw new AiFailedError(`OpenAI request failed (${name})`);
      }

      const completion = CompletionSchema.safeParse(payload);
      if (!completion.success) throw new AiFailedError('OpenAI answer has no choices');
      const { message } = completion.data.choices[0]!;
      if (message.refusal) throw new AiFailedError('OpenAI refused');
      let content: unknown;
      try {
        content = JSON.parse(message.content ?? '');
      } catch {
        throw new AiFailedError('OpenAI content is not JSON');
      }
      const parsed = RawTasksSchema.safeParse(content);
      if (!parsed.success) throw new AiFailedError('OpenAI content does not match the schema');
      const usage = completion.data.usage;
      return {
        tasks: parsed.data.tasks,
        usage: usage
          ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens }
          : null,
      };
    },
  };
}
