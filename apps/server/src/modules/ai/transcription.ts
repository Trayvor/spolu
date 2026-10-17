import { z } from 'zod';
import { AiFailedError } from './provider.js';

// Phase 30: speech to text for meeting recordings. The job splits the audio and sends each part.

/** One part of a recording, already small enough for one request (≤ 25 MB, ≤ 20 minutes). */
export type TranscriptionRequest = { audio: Buffer; fileName: string; mime: string };

/** Turns one audio part into text. Implementations: OpenAI, ElevenLabs Scribe, a fake. */
export interface TranscriptionProvider {
  /** Shown in logs (never the key). */
  readonly name: string;
  transcribe(request: TranscriptionRequest, signal: AbortSignal): Promise<{ text: string }>;
}

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

const TextSchema = z.object({ text: z.string() });

/** POSTs the form and reads `{ text }`; the error body is never read (it may echo the key). */
async function postForm(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  form: FormData,
  signal: AbortSignal,
  who: string,
): Promise<{ text: string }> {
  let payload: unknown;
  try {
    const response = await fetchImpl(url, { method: 'POST', headers, body: form, signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AiFailedError(`${who} answered ${response.status}`);
    }
    payload = await response.json();
  } catch (error) {
    if (error instanceof AiFailedError) throw error;
    const name = error instanceof Error ? error.name : 'unknown';
    throw new AiFailedError(`${who} request failed (${name})`);
  }
  const parsed = TextSchema.safeParse(payload);
  if (!parsed.success) throw new AiFailedError(`${who} answer has no text`);
  return { text: parsed.data.text };
}

const blob = (request: TranscriptionRequest) =>
  new Blob([new Uint8Array(request.audio)], { type: request.mime });

/**
 * OpenAI's `/v1/audio/transcriptions` (default model `gpt-transcribe`). The language is left to
 * the model: meetings mix Slovak, Czech and English.
 */
export function createOpenAiTranscription(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): TranscriptionProvider {
  const fetchImpl = options.fetch ?? fetch;
  return {
    name: 'openai',
    transcribe(request, signal) {
      const form = new FormData();
      form.append('model', options.model);
      form.append('file', blob(request), request.fileName);
      form.append('response_format', 'json');
      return postForm(
        fetchImpl,
        OPENAI_URL,
        { authorization: `Bearer ${options.apiKey}` },
        form,
        signal,
        'OpenAI',
      );
    },
  };
}

/** ElevenLabs Scribe (`/v1/speech-to-text`, default model `scribe_v2`), plain fetch. */
export function createElevenLabsTranscription(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): TranscriptionProvider {
  const fetchImpl = options.fetch ?? fetch;
  return {
    name: 'elevenlabs',
    transcribe(request, signal) {
      const form = new FormData();
      form.append('model_id', options.model);
      form.append('file', blob(request), request.fileName);
      form.append('tag_audio_events', 'false');
      return postForm(
        fetchImpl,
        ELEVENLABS_URL,
        { 'xi-api-key': options.apiKey },
        form,
        signal,
        'ElevenLabs',
      );
    },
  };
}

/** The fake's transcript: a decision, two action items (one with a name and a date), a question. */
export const FAKE_TRANSCRIPT = [
  'Anna: Dobrý deň, poďme na rozpočet projektu.',
  'Peter: Rozhodli sme sa podať žiadosť do konca mesiaca.',
  'Anna: Úloha: Peter pripraví rozpočet do 2030-01-15.',
  'Peter: Úloha: Poslať klientovi zoznam príloh.',
  'Anna: Kto podpíše čestné vyhlásenie?',
].join('\n');

/** A deterministic stand-in for dev and e2e (`TRANSCRIPTION_PROVIDER=fake`): a fixed transcript. */
export function createFakeTranscription(): TranscriptionProvider {
  return {
    name: 'fake',
    async transcribe() {
      return { text: FAKE_TRANSCRIPT };
    },
  };
}
