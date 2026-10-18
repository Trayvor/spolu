import { describe, expect, it, vi } from 'vitest';
import { createOpenAiProvider, renderSplitPrompt, SYSTEM_PROMPTS } from './openai-provider.js';
import { AiFailedError, type SplitRequest } from './provider.js';

const request: SplitRequest = {
  text: 'Ask @Ana about report.pdf by Friday',
  quoted: 'Is the report ready?',
  files: [{ id: 'f1', name: 'report.pdf' }],
  people: [{ id: 'u1', name: 'Ana' }],
  today: '2026-10-16',
  source: 'message',
  details: [],
  conversation: [],
};

const task = {
  title: 'Ask Ana about the report',
  description: 'By Friday',
  assigneeIds: ['u1'],
  fileIds: ['f1'],
  deadline: '2026-10-23',
  urgent: false,
  link: null,
};

const completion = (message: object, usage: object | undefined = undefined) => ({
  choices: [{ message, finish_reason: 'stop' }],
  ...(usage ? { usage } : {}),
});

/** A fetch that answers `response` (each test calls it once; a clone's body would be a tee). */
function stubFetch(response: Response) {
  return vi.fn<typeof fetch>(async () => response);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const provider = (fetchImpl: typeof fetch) =>
  createOpenAiProvider({ apiKey: 'sk-test', model: 'gpt-5-mini', fetch: fetchImpl });

describe('OpenAI provider', () => {
  it('sends the model, the prompt and a strict json_schema, and maps the answer', async () => {
    const fetchImpl = stubFetch(
      json(
        completion(
          { role: 'assistant', content: JSON.stringify({ tasks: [task] }), refusal: null },
          { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
        ),
      ),
    );
    const signal = new AbortController().signal;
    const result = await provider(fetchImpl).split(request, signal);

    expect(result).toEqual({ tasks: [task], usage: { promptTokens: 120, completionTokens: 40 } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init!.method).toBe('POST');
    expect(init!.signal).toBe(signal);
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer sk-test');
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe('gpt-5-mini');
    expect(body).not.toHaveProperty('temperature');
    expect(body.max_completion_tokens).toBe(8000);
    expect(body.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPTS.message });
    expect(body.messages[1].role).toBe('user');
    const user: string = body.messages[1].content;
    expect(user).toContain('Message:\nAsk @Ana about report.pdf by Friday');
    expect(user).toContain('Quoted message:\nIs the report ready?');
    expect(user).toContain('Files (id — name):\nf1 — report.pdf');
    expect(user).toContain('People (id — name):\nu1 — Ana');
    expect(user).toContain('Today:\n2026-10-16');

    expect(body.response_format.type).toBe('json_schema');
    const { name, strict, schema } = body.response_format.json_schema;
    expect(name).toBe('task_split');
    expect(strict).toBe(true);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['tasks']);
    const item = schema.properties.tasks.items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required.sort()).toEqual(
      ['assigneeIds', 'deadline', 'description', 'fileIds', 'link', 'title', 'urgent'].sort(),
    );
    expect(item.properties.deadline.type).toEqual(['string', 'null']);
    expect(item.properties.link.type).toEqual(['string', 'null']);
  });

  it('asks for the web addresses to be kept, copied exactly (owner bug report 2026-10-18)', () => {
    for (const prompt of Object.values(SYSTEM_PROMPTS)) {
      expect(prompt).toContain('Keep every web address (URL)');
      expect(prompt).toContain('copied exactly');
    }
  });

  it('leaves out the quoted section when there is none and marks empty lists', async () => {
    const fetchImpl = stubFetch(json(completion({ content: '{"tasks":[]}', refusal: null })));
    const result = await provider(fetchImpl).split(
      { ...request, quoted: null, files: [] },
      new AbortController().signal,
    );
    expect(result).toEqual({ tasks: [], usage: null });
    const user: string = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string).messages[1]
      .content;
    expect(user).not.toContain('Quoted message:');
    expect(user).toContain('Files (id — name):\n(none)');
  });

  it.each([
    ['a refusal', json(completion({ content: null, refusal: 'I cannot help' }))],
    ['a 500', json({ error: { message: 'boom' } }, 500)],
    ['unparsable content', json(completion({ content: '{"tasks": [', refusal: null }))],
    ['content failing the schema', json(completion({ content: '{"tasks":[{}]}', refusal: null }))],
    ['no choices', json({ choices: [] })],
    ['a body that is not JSON', new Response('<html>', { status: 200 })],
  ])('turns %s into AiFailedError', async (_, response) => {
    await expect(
      provider(stubFetch(response)).split(request, new AbortController().signal),
    ).rejects.toBeInstanceOf(AiFailedError);
  });

  it('releases the body of an error answer', async () => {
    const response = json({ error: { message: 'Incorrect API key provided: sk-te***st' } }, 401);
    const error = await provider(vi.fn<typeof fetch>(async () => response))
      .split(request, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiFailedError);
    expect((error as Error).message).not.toContain('sk-te');
    expect(response.bodyUsed || response.body?.locked).toBe(true);
  });

  it('turns a network error or an abort into AiFailedError without the key', async () => {
    const failing = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    const error = await provider(failing)
      .split(request, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiFailedError);
    expect(String((error as Error).message)).not.toContain('sk-test');

    const controller = new AbortController();
    controller.abort();
    const aborting = vi.fn<typeof fetch>(async (_, init) => {
      init!.signal!.throwIfAborted();
      throw new Error('unreachable');
    });
    await expect(provider(aborting).split(request, controller.signal)).rejects.toBeInstanceOf(
      AiFailedError,
    );
  });
});

describe('the prompt', () => {
  const ticket: SplitRequest = {
    ...request,
    text: 'Error 500\n\nThe Applications tab fails.',
    quoted: null,
    source: 'ticket',
    details: [{ label: 'Area', value: 'Errors' }],
    conversation: [
      { author: 'Vlad', text: 'Did you do anything before?' },
      { author: 'Jana', text: 'I uploaded a file in Chrome.' },
    ],
  };

  it('a ticket goes with its details and its chat, oldest first, and the ticket prompt', async () => {
    const user = renderSplitPrompt(ticket);
    expect(user).toContain('Ticket:\nError 500\n\nThe Applications tab fails.');
    expect(user).toContain('Details (context only, never copy them into a card):\nArea: Errors');
    expect(user).toContain(
      'Ticket chat (oldest first):\nVlad: Did you do anything before?\nJana: I uploaded a file in Chrome.',
    );
    expect(user).not.toContain('Message:');

    const fetchImpl = stubFetch(json(completion({ content: JSON.stringify({ tasks: [] }) })));
    await provider(fetchImpl).split(ticket, new AbortController().signal);
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body.messages[0].content).toBe(SYSTEM_PROMPTS.ticket);
  });

  it('a message has no details or chat sections', () => {
    const user = renderSplitPrompt(request);
    expect(user).not.toContain('Details');
    expect(user).not.toContain('Ticket chat');
  });

  it('both prompts forbid metadata lines, ticket numbers in titles and generic advice', () => {
    for (const prompt of [SYSTEM_PROMPTS.message, SYSTEM_PROMPTS.ticket]) {
      expect(prompt).toContain('never add a ticket number');
      expect(prompt).toContain('Never add labelled metadata lines');
      expect(prompt).toContain('never generic advice');
      expect(prompt).toContain('otherwise add no notes');
    }
    expect(SYSTEM_PROMPTS.ticket).toContain('language of the ticket and its chat');
  });
});
