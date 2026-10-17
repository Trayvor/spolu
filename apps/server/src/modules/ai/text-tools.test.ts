import { describe, expect, it } from 'vitest';
import { AiFailedError } from './provider.js';
import {
  createFakeTextTools,
  createOpenAiTextTools,
  systemPromptFor,
  type TextToolRequest,
} from './text-tools.js';

const completion = (content: string | null, extra: object = {}) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content, ...extra } }],
      usage: { prompt_tokens: 30, completion_tokens: 12 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

function stubFetch(answer: () => Response) {
  const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      auth: (init.headers as Record<string, string>).authorization!,
    });
    return answer();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const fix: TextToolRequest = { action: 'fix', text: 'ahoj ako sa mas' };
const signal = () => new AbortController().signal;

describe('systemPromptFor', () => {
  it('fix changes only punctuation, diacritics and typos', () => {
    const prompt = systemPromptFor(fix);
    expect(prompt).toMatch(/punctuation/i);
    expect(prompt).toMatch(/diacritics/i);
    expect(prompt).toMatch(/change nothing else/i);
    expect(prompt).toMatch(/@mention/);
  });

  it('formal is professional, not an email, and turns spoken enumerations into a numbered list', () => {
    const prompt = systemPromptFor({ action: 'formal', text: 'x' });
    expect(prompt).toMatch(/not an email/i);
    expect(prompt).toMatch(/numbered list/i);
    expect(prompt).toMatch(/task one/i);
    expect(prompt).toMatch(/anglicisms/i);
    expect(prompt).toMatch(/never change the meaning/i);
  });

  it('translate names the target language', () => {
    expect(systemPromptFor({ action: 'translate', text: 'x', language: 'Czech' })).toMatch(
      /into Czech/,
    );
  });
});

describe('createOpenAiTextTools', () => {
  it('posts the action prompt and the text, with the model and reasoning effort', async () => {
    const { calls, fetchImpl } = stubFetch(() =>
      completion(JSON.stringify({ text: 'Ahoj, ako sa máš?' })),
    );
    const tools = createOpenAiTextTools({
      apiKey: 'sk-test',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
      fetch: fetchImpl,
    });
    const result = await tools.rewrite(fix, signal());
    expect(result).toEqual({
      text: 'Ahoj, ako sa máš?',
      usage: { promptTokens: 30, completionTokens: 12 },
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call!.auth).toBe('Bearer sk-test');
    expect(call!.body.model).toBe('gpt-5.4-mini');
    expect(call!.body.reasoning_effort).toBe('low');
    const messages = call!.body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: 'system', content: systemPromptFor(fix) });
    expect(messages[1]).toEqual({ role: 'user', content: 'ahoj ako sa mas' });
    expect(call!.body.response_format).toMatchObject({ type: 'json_schema' });
  });

  it('omits reasoning_effort when it is off', async () => {
    const { calls, fetchImpl } = stubFetch(() => completion(JSON.stringify({ text: 'ok' })));
    const tools = createOpenAiTextTools({
      apiKey: 'k',
      model: 'gpt-4.1-mini',
      reasoningEffort: 'off',
      fetch: fetchImpl,
    });
    await tools.rewrite(fix, signal());
    expect('reasoning_effort' in calls[0]!.body).toBe(false);
  });

  it('fails without leaking the error body', async () => {
    const tools = (answer: () => Response) =>
      createOpenAiTextTools({
        apiKey: 'k',
        model: 'm',
        reasoningEffort: 'low',
        fetch: stubFetch(answer).fetchImpl,
      });
    await expect(
      tools(() => new Response('bad key sk-xxx', { status: 401 })).rewrite(fix, signal()),
    ).rejects.toThrow(new AiFailedError('OpenAI answered 401'));
    await expect(tools(() => completion('not json')).rewrite(fix, signal())).rejects.toThrow(
      AiFailedError,
    );
    await expect(
      tools(() => completion(null, { refusal: 'no' })).rewrite(fix, signal()),
    ).rejects.toThrow(AiFailedError);
    await expect(
      tools(() => completion(JSON.stringify({ text: '   ' }))).rewrite(fix, signal()),
    ).rejects.toThrow(AiFailedError);
  });

  it('a network error becomes AiFailedError', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const tools = createOpenAiTextTools({
      apiKey: 'k',
      model: 'm',
      reasoningEffort: 'low',
      fetch: fetchImpl,
    });
    await expect(tools.rewrite(fix, signal())).rejects.toThrow('OpenAI request failed (TypeError)');
  });
});

describe('createFakeTextTools', () => {
  const fake = createFakeTextTools();

  it('fix capitalizes and ends the text with a full stop', async () => {
    expect((await fake.rewrite(fix, signal())).text).toBe('Ahoj ako sa mas.');
  });

  it('formal turns a spoken enumeration into a numbered list', async () => {
    const text = 'task one: call the bank, task two: send the report';
    expect((await fake.rewrite({ action: 'formal', text }, signal())).text).toBe(
      '1. Call the bank\n2. Send the report',
    );
    expect((await fake.rewrite({ action: 'formal', text: 'hello' }, signal())).text).toBe(
      'Formally: hello',
    );
  });

  it('translate marks the language', async () => {
    const result = await fake.rewrite(
      { action: 'translate', text: 'ahoj', language: 'English' },
      signal(),
    );
    expect(result.text).toBe('[English] ahoj');
  });
});
