import { describe, expect, it } from 'vitest';
import { AiFailedError } from './provider.js';
import {
  createElevenLabsTranscription,
  createFakeTranscription,
  createOpenAiTranscription,
  FAKE_TRANSCRIPT,
} from './transcription.js';

type Seen = { url: string; headers: Record<string, string>; form: FormData };

function stubFetch(answer: () => Response) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({
      url,
      headers: init.headers as Record<string, string>,
      form: init.body as FormData,
    });
    return answer();
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

const request = { audio: Buffer.from('abc'), fileName: 'part-0000.m4a', mime: 'audio/mp4' };
const signal = new AbortController().signal;

describe('transcription providers', () => {
  it('OpenAI: posts the part with the model and reads the text', async () => {
    const { seen, fetchImpl } = stubFetch(() => Response.json({ text: 'Ahoj' }));
    const provider = createOpenAiTranscription({
      apiKey: 'sk-test',
      model: 'gpt-transcribe',
      fetch: fetchImpl,
    });
    expect(await provider.transcribe(request, signal)).toEqual({ text: 'Ahoj' });
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(seen[0]!.headers.authorization).toBe('Bearer sk-test');
    expect(seen[0]!.form.get('model')).toBe('gpt-transcribe');
    const file = seen[0]!.form.get('file') as File;
    expect(file.name).toBe('part-0000.m4a');
    expect(file.size).toBe(3);
  });

  it('ElevenLabs: posts to speech-to-text with xi-api-key and model_id', async () => {
    const { seen, fetchImpl } = stubFetch(() => Response.json({ text: 'Hi', words: [] }));
    const provider = createElevenLabsTranscription({
      apiKey: 'el-key',
      model: 'scribe_v2',
      fetch: fetchImpl,
    });
    expect(await provider.transcribe(request, signal)).toEqual({ text: 'Hi' });
    expect(seen[0]!.url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(seen[0]!.headers['xi-api-key']).toBe('el-key');
    expect(seen[0]!.form.get('model_id')).toBe('scribe_v2');
  });

  it('an error answer fails and releases its body unread (it may echo the key)', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const { fetchImpl } = stubFetch(() => new Response(body, { status: 401 }));
    const provider = createOpenAiTranscription({
      apiKey: 'sk-secret',
      model: 'm',
      fetch: fetchImpl,
    });
    const error = await provider.transcribe(request, signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiFailedError);
    expect((error as Error).message).toBe('OpenAI answered 401');
    expect((error as Error).message).not.toContain('sk-secret');
    // Released, not read.
    expect(cancelled).toBe(true);
  });

  it('a network error or an answer without text fails', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      createOpenAiTranscription({ apiKey: 'k', model: 'm', fetch: failing }).transcribe(
        request,
        signal,
      ),
    ).rejects.toThrow('OpenAI request failed (TypeError)');
    const { fetchImpl } = stubFetch(() => Response.json({ nope: 1 }));
    await expect(
      createElevenLabsTranscription({ apiKey: 'k', model: 'm', fetch: fetchImpl }).transcribe(
        request,
        signal,
      ),
    ).rejects.toThrow(AiFailedError);
  });

  it('the fake answers its fixed transcript', async () => {
    expect(await createFakeTranscription().transcribe(request, signal)).toEqual({
      text: FAKE_TRANSCRIPT,
    });
  });
});
