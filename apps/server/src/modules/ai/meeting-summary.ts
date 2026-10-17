import { z } from 'zod';
import { MEETING_LIMITS, type MeetingSummary } from '@spolu/shared';
import { AiFailedError } from './provider.js';

// Phase 30: the structured summary of a meeting's transcript.

/** What the AI gets: only text and names leave the server. */
export type MeetingSummaryRequest = {
  title: string;
  /** The meeting's date and time, as text (Bratislava). */
  startsAt: string;
  notes: string;
  transcript: string;
  /** The group's people, so names are spelled as in Spolu. */
  people: string[];
  /** YYYY-MM-DD, Europe/Bratislava: relative deadlines ("by Friday") become dates. */
  today: string;
};

export type MeetingSummaryResult = {
  summary: MeetingSummary;
  usage: { promptTokens: number; completionTokens: number } | null;
};

export interface MeetingSummaryProvider {
  summarize(request: MeetingSummaryRequest, signal: AbortSignal): Promise<MeetingSummaryResult>;
}

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_COMPLETION_TOKENS = 16_000;

export const MEETING_SYSTEM_PROMPT = [
  'You summarize the transcript of a work meeting or call for the team and its client.',
  'Write everything in the language the meeting was spoken in (the transcript\'s main language), and give that language as an ISO 639-1 code in "language".',
  '"summary": a short paragraph (at most 2000 characters) with what the meeting was about and how it ended.',
  '"decisions": what was decided, one short sentence each; [] when nothing was decided.',
  '"actionItems": the jobs someone agreed to do, each a short action ("Send the client the list of attachments"). "assignee" is the name of who does it only when the meeting says so (spell it as in the People list when it is one of them), otherwise null. "deadline" is YYYY-MM-DD only when a date or a relative day is said (use Today for relative days), otherwise null.',
  '"openQuestions": questions left without an answer; [] when none.',
  'At most 30 entries per list, each at most 500 characters. Never invent anything the transcript does not say. Ignore small talk.',
].join(' ');

const strings = (description: string) => ({
  type: 'array',
  items: { type: 'string' },
  description,
});

/** The strict structured-output schema (lengths are enforced by `sanitizeSummary`). */
export const MEETING_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'decisions', 'actionItems', 'openQuestions', 'language'],
  properties: {
    summary: { type: 'string', description: 'At most 2000 characters.' },
    decisions: strings('At most 30.'),
    actionItems: {
      type: 'array',
      description: 'At most 30.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'assignee', 'deadline'],
        properties: {
          text: { type: 'string' },
          assignee: { type: ['string', 'null'] },
          deadline: { type: ['string', 'null'], description: 'YYYY-MM-DD or null.' },
        },
      },
    },
    openQuestions: strings('At most 30.'),
    language: { type: ['string', 'null'], description: 'ISO 639-1 code.' },
  },
} as const;

const RawSummarySchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  actionItems: z.array(
    z.object({
      text: z.string(),
      assignee: z.string().nullable(),
      deadline: z.string().nullable(),
    }),
  ),
  openQuestions: z.array(z.string()),
  language: z.string().nullable(),
});
type RawSummary = z.infer<typeof RawSummarySchema>;

const cut = (text: string, max: number): string =>
  Array.from(text.trim()).slice(0, max).join('').trim();

const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const entries = (values: string[]) =>
  values
    .map((v) => cut(v, MEETING_LIMITS.listItem))
    .filter((v) => v !== '')
    .slice(0, MEETING_LIMITS.listItems);

/** Makes the AI's answer fit `MeetingSummarySchema`: trimmed, cut, no blanks, real dates only. */
export function sanitizeSummary(raw: RawSummary): MeetingSummary {
  return {
    summary: cut(raw.summary, MEETING_LIMITS.summary),
    decisions: entries(raw.decisions),
    actionItems: raw.actionItems
      .map((a) => ({
        text: cut(a.text, MEETING_LIMITS.listItem),
        assignee:
          a.assignee && a.assignee.trim() !== '' ? cut(a.assignee, MEETING_LIMITS.assignee) : null,
        deadline:
          a.deadline !== null && isCalendarDate(a.deadline.trim()) ? a.deadline.trim() : null,
      }))
      .filter((a) => a.text !== '')
      .slice(0, MEETING_LIMITS.listItems),
    openQuestions: entries(raw.openQuestions),
    language:
      raw.language && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(raw.language.trim())
        ? raw.language.trim()
        : null,
  };
}

/** The user message: labelled sections. */
export function renderMeetingPrompt(request: MeetingSummaryRequest): string {
  return [
    `Meeting: ${request.title}`,
    `When: ${request.startsAt}`,
    `Today: ${request.today}`,
    `People (id-less names): ${request.people.length === 0 ? '(none)' : request.people.join(', ')}`,
    ...(request.notes.trim() === '' ? [] : [`Notes written by the team:\n${request.notes}`]),
    `Transcript:\n${request.transcript}`,
  ].join('\n\n');
}

const CompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).nullish(),
});

/** Chat Completions with a strict JSON schema, through `fetch` (no SDK), like the task split. */
export function createOpenAiMeetingSummary(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): MeetingSummaryProvider {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async summarize(request, signal) {
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
            max_completion_tokens: MAX_COMPLETION_TOKENS,
            messages: [
              { role: 'system', content: MEETING_SYSTEM_PROMPT },
              { role: 'user', content: renderMeetingPrompt(request) },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'meeting_summary',
                strict: true,
                schema: MEETING_SUMMARY_SCHEMA,
              },
            },
          }),
          signal,
        });
        if (!response.ok) {
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
      const parsed = RawSummarySchema.safeParse(content);
      if (!parsed.success) throw new AiFailedError('OpenAI content does not match the schema');
      const usage = completion.data.usage;
      return {
        summary: sanitizeSummary(parsed.data),
        usage: usage
          ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens }
          : null,
      };
    },
  };
}

const DECISION = /^(?:rozhodli|rozhodnutie|decided|decision)/iu;
const ACTION = /(?:úloha|todo|action):\s*(.+)$/iu;
const DATE = /\d{4}-\d{2}-\d{2}/;

/**
 * Dev and e2e (`AI_PROVIDER=fake`): lines after an optional "Name:" speaker are sorted by their
 * start: "Rozhodli…"/"Decision…" are decisions, "Úloha:"/"TODO:"/"Action:" action items (a
 * person of the group named in it is the assignee, the first YYYY-MM-DD the deadline), lines
 * ending in "?" open questions; the first line is the summary.
 */
export function createFakeMeetingSummary(): MeetingSummaryProvider {
  return {
    async summarize(request) {
      const lines = request.transcript
        .split('\n')
        .map((line) => line.replace(/^[^:]{1,40}:\s+/u, '').trim())
        .filter(Boolean);
      const raw: RawSummary = {
        summary: lines[0] ?? '',
        decisions: lines.filter((l) => DECISION.test(l)),
        actionItems: lines.flatMap((l) => {
          const text = ACTION.exec(l)?.[1]?.trim();
          if (!text) return [];
          const first = (name: string) => name.split(' ')[0] ?? name;
          const assignee = request.people.find((p) => text.includes(first(p))) ?? null;
          return [{ text, assignee, deadline: DATE.exec(text)?.[0] ?? null }];
        }),
        openQuestions: lines.filter((l) => l.endsWith('?')),
        language: 'sk',
      };
      return { summary: sanitizeSummary(raw), usage: null };
    },
  };
}
