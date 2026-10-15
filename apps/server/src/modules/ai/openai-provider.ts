import { z } from 'zod';
import { AI_DESCRIPTION_MAX, AI_MAX_TASKS, AI_TITLE_MAX } from '@spolu/shared';
import { AiFailedError, type SplitRequest, type TaskSplitProvider } from './provider.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export const SYSTEM_PROMPT =
  'You turn one chat message into task cards for a project board. Write every title and description in the language of the message. Make one task per distinct job; do not split one job into steps. Set assigneeIds, deadline (YYYY-MM-DD) and urgent only when the message states them clearly; otherwise use [], null and false. Use only ids from the lists given. Give each file to the task or tasks it belongs to (fileIds); a file may belong to several tasks or to none. Titles are short (at most 200 characters); descriptions keep the details the message gives (at most 5000 characters). Return at most 10 tasks, or none if the message describes no job.';

const ids = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

/**
 * The structured-output schema. Strict mode needs every property required and no extra ones;
 * it cannot express lengths or counts, so those are in the descriptions and enforced by
 * `sanitizeProposals`.
 */
export const TASK_SPLIT_SCHEMA = {
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
        required: ['title', 'description', 'assigneeIds', 'fileIds', 'deadline', 'urgent'],
        properties: {
          title: { type: 'string', description: `At most ${AI_TITLE_MAX} characters.` },
          description: { type: 'string', description: `At most ${AI_DESCRIPTION_MAX} characters.` },
          assigneeIds: ids('Ids from the People list; [] unless the message names them clearly.'),
          fileIds: ids('Ids from the Files list that belong to this task.'),
          deadline: {
            type: ['string', 'null'],
            description: 'YYYY-MM-DD, or null unless the message states a deadline clearly.',
          },
          urgent: { type: 'boolean', description: 'True only when the message says so clearly.' },
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

/** The user message: the request as labelled sections. */
export function renderSplitPrompt(request: SplitRequest): string {
  return [
    `Message:\n${request.text}`,
    ...(request.quoted === null ? [] : [`Quoted message:\n${request.quoted}`]),
    `Files (id — name):\n${list(request.files)}`,
    `People (id — name):\n${list(request.people)}`,
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
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: renderSplitPrompt(request) },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'task_split', strict: true, schema: TASK_SPLIT_SCHEMA },
            },
          }),
          signal,
        });
        // The error body is not kept: an auth error echoes part of the key.
        if (!response.ok) throw new AiFailedError(`OpenAI answered ${response.status}`);
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
