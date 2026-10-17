import { describe, expect, it } from 'vitest';
import {
  createFakeMeetingSummary,
  createOpenAiMeetingSummary,
  MEETING_SYSTEM_PROMPT,
  renderMeetingPrompt,
  sanitizeSummary,
} from './meeting-summary.js';
import { AiFailedError } from './provider.js';

const request = {
  title: 'Kickoff',
  startsAt: 'Friday 17 October 2026 at 10:00',
  notes: '',
  transcript: 'Anna: Hello.\nPeter: Úloha: Peter sends the list by 2030-01-02.\nAnna: Who signs?',
  people: ['Peter Novák', 'Anna Malá'],
  today: '2026-10-17',
};
const signal = new AbortController().signal;

describe('meeting summary', () => {
  it('sanitizes: trims, cuts, drops blanks and fake dates', () => {
    const summary = sanitizeSummary({
      summary: `  ${'x'.repeat(3000)} `,
      decisions: ['  A ', ' ', ...Array.from({ length: 40 }, (_, i) => `d${i}`)],
      actionItems: [
        { text: ' Do it ', assignee: '  ', deadline: '2030-02-30' },
        { text: '', assignee: 'X', deadline: null },
        { text: 'Other', assignee: 'Peter', deadline: '2030-02-28' },
      ],
      openQuestions: ['Why?'],
      language: 'sk',
    });
    expect(summary.summary).toHaveLength(2000);
    expect(summary.decisions[0]).toBe('A');
    expect(summary.decisions).toHaveLength(30);
    expect(summary.actionItems).toEqual([
      { text: 'Do it', assignee: null, deadline: null },
      { text: 'Other', assignee: 'Peter', deadline: '2030-02-28' },
    ]);
    expect(sanitizeSummary({ ...summary, language: 'not a code' }).language).toBeNull();
  });

  it('OpenAI: a strict schema, the transcript in the user message, the language rule', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string) as Record<string, unknown>;
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'Done',
                decisions: [],
                actionItems: [{ text: 'Send', assignee: 'Peter Novák', deadline: '2030-01-02' }],
                openQuestions: ['Who signs?'],
                language: 'sk',
              }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }) as unknown as typeof fetch;
    const provider = createOpenAiMeetingSummary({
      apiKey: 'k',
      model: 'gpt-5-mini',
      fetch: fetchImpl,
    });
    const result = await provider.summarize(request, signal);
    expect(result.summary.actionItems[0]).toEqual({
      text: 'Send',
      assignee: 'Peter Novák',
      deadline: '2030-01-02',
    });
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect(body.model).toBe('gpt-5-mini');
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]!.content).toBe(MEETING_SYSTEM_PROMPT);
    expect(MEETING_SYSTEM_PROMPT).toContain('language the meeting was spoken in');
    expect(messages[1]!.content).toBe(renderMeetingPrompt(request));
    expect(messages[1]!.content).toContain('Transcript:\nAnna: Hello.');
    expect((body.response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(
      true,
    );
  });

  it('OpenAI: an error status, a refusal or a bad answer fail', async () => {
    const answer = (response: Response) =>
      createOpenAiMeetingSummary({
        apiKey: 'k',
        model: 'm',
        fetch: (async () => response) as unknown as typeof fetch,
      }).summarize(request, signal);
    await expect(answer(new Response('{}', { status: 500 }))).rejects.toThrow(
      'OpenAI answered 500',
    );
    await expect(
      answer(Response.json({ choices: [{ message: { content: null, refusal: 'no' } }] })),
    ).rejects.toThrow('OpenAI refused');
    await expect(
      answer(Response.json({ choices: [{ message: { content: '{"summary":1}' } }] })),
    ).rejects.toThrow(AiFailedError);
  });

  it('the fake finds decisions, action items with people and dates, questions', async () => {
    const { summary } = await createFakeMeetingSummary().summarize(request, signal);
    expect(summary.summary).toBe('Hello.');
    expect(summary.actionItems).toEqual([
      {
        text: 'Peter sends the list by 2030-01-02.',
        assignee: 'Peter Novák',
        deadline: '2030-01-02',
      },
    ]);
    expect(summary.openQuestions).toEqual(['Who signs?']);
  });
});
