import { describe, expect, it } from 'vitest';
import type { Facts } from '../weekly-summary/facts.js';
import { AiFailedError } from './provider.js';
import {
  createFakeWeeklySummary,
  createOpenAiWeeklySummary,
  sanitizeWeeklyDraft,
  WEEKLY_SYSTEM_PROMPT,
  type RawWeeklyDraft,
  type WeeklySummaryRequest,
} from './weekly-summary.js';

const facts: Facts = {
  done: [{ key: 't1', ref: { kind: 'task', id: 'task-id-1' }, text: 'Rozpočet', date: null }],
  waiting: [],
  upcoming: [
    { key: 'e1', ref: { kind: 'event', id: 'event-id-1' }, text: 'Podanie', date: '2026-10-20' },
  ],
  messages: [],
};
const raw = (over: Partial<RawWeeklyDraft> = {}): RawWeeklyDraft => ({
  intro: 'Dobrý deň',
  done: [],
  waiting: [],
  upcoming: [],
  closing: 'S pozdravom',
  ...over,
});
const request: WeeklySummaryRequest = {
  groupName: 'Firma',
  language: 'sk',
  today: '2026-10-23',
  range: '16. 10. – 23. 10. 2026',
  facts: {
    done: [{ key: 't1', text: 'Rozpočet', date: null }],
    waiting: [],
    upcoming: [{ key: 'e1', text: 'Podanie', date: '2026-10-20' }],
  },
  messages: [{ author: 'Jana Nováková', text: 'Ďakujeme', at: '2026-10-21 10:00', place: null }],
};
const signal = new AbortController().signal;
const answer = (content: unknown) =>
  (async () =>
    Response.json({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    })) as unknown as typeof fetch;

describe('weekly summary AI', () => {
  it('sanitize maps known keys to refs and unknown keys to null', () => {
    const draft = sanitizeWeeklyDraft(
      raw({
        done: [
          { key: 't1', text: 'A' },
          { key: 'x9', text: 'B' },
          { key: null, text: 'C' },
        ],
      }),
      facts,
    );
    expect(draft.done.map((i) => i.ref)).toEqual([{ kind: 'task', id: 'task-id-1' }, null, null]);
  });

  it('sanitize cuts texts and sections', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ key: null, text: `Item ${i}` }));
    const draft = sanitizeWeeklyDraft(
      raw({
        intro: 'x'.repeat(900),
        closing: 'y'.repeat(400),
        waiting: [...many, { key: null, text: '   ' }],
        upcoming: [{ key: 'e1', text: 'z'.repeat(800) }],
      }),
      facts,
    );
    expect(draft.waiting).toHaveLength(15);
    expect(draft.intro).toHaveLength(600);
    expect(draft.closing).toHaveLength(300);
    expect(draft.upcoming[0]!.text).toHaveLength(500);
  });

  it('sanitize keeps markup as text', () => {
    const draft = sanitizeWeeklyDraft(raw({ done: [{ key: null, text: '<b>hi</b>' }] }), facts);
    expect(draft.done[0]!.text).toBe('<b>hi</b>');
  });

  it('the OpenAI request sends only text and names', async () => {
    let body = '';
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = init.body as string;
      return Response.json({
        choices: [
          { message: { content: JSON.stringify(raw({ done: [{ key: 't1', text: 'A' }] })) } },
        ],
      });
    }) as unknown as typeof fetch;
    const provider = createOpenAiWeeklySummary({ apiKey: 'k', model: 'm', fetch: fetchImpl });
    const result = await provider.draft(request, signal);
    expect(result.draft.done).toEqual([{ key: 't1', text: 'A' }]);
    expect(body).toContain('Rozpočet');
    expect(body).toContain('Jana Nováková');
    expect(body).not.toContain('@example');
    expect(body).not.toContain('task-id-1');
    expect(body).not.toContain('event-id-1');
    const parsed = JSON.parse(body) as { response_format: { json_schema: { strict: boolean } } };
    expect(parsed.response_format.json_schema.strict).toBe(true);
  });

  it('an error status, a refusal or invalid JSON throws AiFailedError', async () => {
    const status = (async () =>
      new Response('internal details', { status: 500 })) as unknown as typeof fetch;
    const refusal = (async () =>
      Response.json({
        choices: [{ message: { content: null, refusal: 'no' } }],
      })) as unknown as typeof fetch;
    const junk = (async () =>
      Response.json({
        choices: [{ message: { content: 'not json' } }],
      })) as unknown as typeof fetch;
    for (const f of [status, refusal, junk, answer({ intro: 1 })]) {
      const provider = createOpenAiWeeklySummary({ apiKey: 'k', model: 'm', fetch: f });
      const error = await provider.draft(request, signal).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiFailedError);
      expect((error as Error).message).not.toContain('internal details');
    }
  });

  it('the system prompt asks for formal address and only the given facts', () => {
    expect(WEEKLY_SYSTEM_PROMPT).toContain('formal');
    expect(WEEKLY_SYSTEM_PROMPT).toContain('Never invent');
  });

  it('the fake turns each fact into one item', async () => {
    const result = await createFakeWeeklySummary().draft(request, signal);
    expect(result.draft.intro).toBe('Fake intro');
    expect(result.draft.upcoming).toEqual([{ key: 'e1', text: 'Podanie' }]);
  });
});
