import { describe, expect, it } from 'vitest';
import { AiFailedError } from './provider.js';
import {
  buildDraftUserMessage,
  createFakeTicketDraft,
  createOpenAiTicketDraft,
  sanitizeDraft,
  systemPromptForDraft,
  type TicketDraftInput,
} from './ticket-draft.js';

const KEY = 'sk-test-secret-key';

function request(over: Partial<TicketDraftInput> = {}): TicketDraftInput {
  return {
    ticket: {
      number: 123,
      subject: 'Zmena rozpočtu',
      area: null,
      programme: null,
      status: 'new',
      requesterFirstName: 'Ján',
      body: 'Potrebujeme zmeniť rozpočet.',
    },
    conversation: [],
    knowledge: [],
    similarTickets: [],
    instructions: '',
    fallbackLanguage: 'Slovak',
    ...over,
  };
}

/** Every part at its cap and more: 3 similar tickets of 30 000, 5 knowledge items, a long chat. */
function hugeRequest(): TicketDraftInput {
  return request({
    ticket: { ...request().ticket, body: 'b'.repeat(10_000) },
    conversation: Array.from({ length: 40 }, (_, i) => ({
      author: `A${i}`,
      role: i % 2 ? ('team' as const) : ('client' as const),
      text: 'c'.repeat(2000),
    })),
    knowledge: Array.from({ length: 5 }, (_, i) => ({
      id: `k${i}`,
      type: 'note',
      title: `K${i}`,
      text: 'k'.repeat(3000),
    })),
    similarTickets: Array.from({ length: 3 }, (_, i) => ({
      id: `t${i}`,
      subject: `S${i}`,
      body: 's'.repeat(30_000),
      answers: Array.from({ length: 8 }, () => 'a'.repeat(3000)),
    })),
    instructions: 'i'.repeat(5000),
  });
}

const completion = (content: unknown, extra: object = {}) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content), ...extra } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

function stubFetch(answer: () => Response) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return answer();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('sanitizeDraft', () => {
  it('strips mentions', () => {
    expect(sanitizeDraft({ reply: 'Ahoj <@u1>, @all pozri', sourceIds: [] }, new Set()).reply).toBe(
      'Ahoj , pozri',
    );
    expect(
      sanitizeDraft({ reply: '<@all> @here a @Channel', sourceIds: [] }, new Set()).reply,
    ).toBe('a');
  });

  it('drops unknown and duplicate source ids', () => {
    expect(
      sanitizeDraft({ reply: 'x', sourceIds: ['k1', 'zz', 'k1', 't1'] }, new Set(['k1', 't1']))
        .sourceIds,
    ).toEqual(['k1', 't1']);
  });

  it("masks another client's identity", () => {
    expect(
      sanitizeDraft(
        { reply: 'Ako sme riešili pre Obec Horná Lehota s pánom Novákom…', sourceIds: [] },
        new Set(),
        { names: ['Ján Novák'], clients: ['Obec Horná Lehota'] },
      ).reply,
    ).not.toMatch(/Lehota|Novák/);
  });

  it('cuts a long reply at a paragraph under 6000', () => {
    const r = sanitizeDraft(
      { reply: ('a'.repeat(4000) + '\n\n').repeat(2), sourceIds: [] },
      new Set(),
    ).reply;
    expect(r.length).toBeLessThanOrEqual(6000);
    expect(r.endsWith('a')).toBe(true);
  });
});

describe('buildDraftUserMessage', () => {
  it('stays under 40 000 and drops similar tickets before knowledge', () => {
    const msg = buildDraftUserMessage(hugeRequest());
    expect(msg.length).toBeLessThanOrEqual(40_000);
    const parsed = JSON.parse(msg);
    expect(parsed.similarTickets.length).toBeLessThan(3);
    expect(parsed.knowledge).toHaveLength(5);
    expect(parsed.ticket.body.length).toBeLessThanOrEqual(4000);
    expect(parsed.instructions.length).toBeLessThanOrEqual(1000);
    for (const t of parsed.similarTickets) {
      expect(t.body.length).toBeLessThanOrEqual(1000);
      expect(t.answers.length).toBeLessThanOrEqual(5);
    }
    expect(parsed).not.toHaveProperty('fallbackLanguage');
  });

  it('caps messages at 1500 and the conversation at 12 000, the oldest dropped', () => {
    const parsed = JSON.parse(
      buildDraftUserMessage(
        request({
          conversation: Array.from({ length: 30 }, (_, i) => ({
            author: `A${i}`,
            role: 'client' as const,
            text: 'c'.repeat(2000),
          })),
        }),
      ),
    );
    const texts: { author: string; text: string }[] = parsed.conversation;
    expect(texts.every((m) => m.text.length <= 1500)).toBe(true);
    expect(texts.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(12_000);
    expect(texts.at(-1)!.author).toBe('A29');
    expect(texts[0]!.author).not.toBe('A0');
  });
});

describe('systemPromptForDraft', () => {
  it('names the fallback language, the formal register and the data-not-instructions rule', () => {
    const p = systemPromptForDraft('Slovak');
    expect(p).toContain('Slovak');
    expect(p).toMatch(/formal/i);
    expect(p).toMatch(/not instructions/i);
    expect(p).toMatch(/never name a person/i);
  });
});

describe('createOpenAiTicketDraft', () => {
  it('sends a strict json_schema and maps the answer', async () => {
    const { calls, fetchImpl } = stubFetch(() =>
      completion({ reply: 'Dobrý deň', sourceIds: ['k1'] }),
    );
    const provider = createOpenAiTicketDraft({
      apiKey: KEY,
      model: 'gpt-5-mini',
      fetch: fetchImpl,
    });
    const result = await provider.draft(request(), new AbortController().signal);
    expect(result).toEqual({
      reply: 'Dobrý deň',
      sourceIds: ['k1'],
      usage: { promptTokens: 100, completionTokens: 20 },
    });
    const body = calls[0]!.body as {
      model: string;
      max_completion_tokens: number;
      response_format: { json_schema: { strict: boolean } };
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('gpt-5-mini');
    expect(body.max_completion_tokens).toBe(6000);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(JSON.parse(body.messages[1]!.content).ticket.subject).toBe('Zmena rozpočtu');
  });

  it('turns a refusal or a non-2xx answer into AiFailedError without the key', async () => {
    for (const answer of [
      () => completion(null, { refusal: 'no' }),
      () => new Response(`bad key ${KEY}`, { status: 401 }),
    ]) {
      const { fetchImpl } = stubFetch(answer);
      const provider = createOpenAiTicketDraft({ apiKey: KEY, model: 'm', fetch: fetchImpl });
      const error = await provider.draft(request(), new AbortController().signal).catch((e) => e);
      expect(error).toBeInstanceOf(AiFailedError);
      expect(String(error.message)).not.toContain(KEY);
    }
  });
});

describe('createFakeTicketDraft', () => {
  it('quotes the subject and cites the first source', async () => {
    const result = await createFakeTicketDraft().draft(
      request({
        knowledge: [
          { id: 'k1', type: 'note', title: 'A', text: '' },
          { id: 'k2', type: 'note', title: 'B', text: '' },
        ],
      }),
      new AbortController().signal,
    );
    expect(result.reply).toContain('Zmena rozpočtu');
    expect(result.reply).toContain('Ján');
    expect(result.sourceIds).toEqual(['k1']);
  });
});
