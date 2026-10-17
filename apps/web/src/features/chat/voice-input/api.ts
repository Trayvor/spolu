import { AiTextResultSchema } from '@spolu/shared';
import { i18n } from '@/i18n';
import { ApiError } from '@/lib/api';

/** Sends one recording to the server and returns its transcript; the audio is not stored. */
export async function transcribe(channelId: string, audio: Blob): Promise<string> {
  const path = `/channels/${encodeURIComponent(channelId)}/transcribe`;
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Accept-Language': i18n.language,
      'Content-Type': audio.type || 'audio/webm',
    },
    body: audio,
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new ApiError(`POST ${path} failed (HTTP ${res.status})`, res.status, data);
  const parsed = AiTextResultSchema.safeParse(data);
  if (!parsed.success) throw new ApiError(`Response from ${path} has no text`, res.status, data);
  return parsed.data.text;
}

/** The draft with the transcript added after it: a space within a line, nothing when empty. */
export function appendTranscript(draft: string, transcript: string): string {
  const text = transcript.trim();
  if (text === '') return draft;
  if (draft.trim() === '') return text;
  return /\s$/.test(draft) ? `${draft}${text}` : `${draft} ${text}`;
}
