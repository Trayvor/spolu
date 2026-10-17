import { ErrorCodes, MEETING_LIMITS, TranscriptTextSchema } from '@spolu/shared';
import { i18n } from '@/i18n';
import { ApiError, apiSend } from '@/lib/api';

// Phase 30: a meeting's recording, its AI run and transcript files. Lazy: only the knowledge
// dialog imports this.

const enc = encodeURIComponent;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Uploads a recording (audio or video, up to 2 GB) to a meeting; `onProgress` gets the sent
 * fraction. The server answers 202 and transcodes it in the background.
 */
export function uploadRecording(
  itemId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const path = `/knowledge/${enc(itemId)}/recording`;
  if (file.size > MEETING_LIMITS.recordingBytes) {
    return Promise.reject(
      new ApiError('Recording is too large', 413, { error: ErrorCodes.fileTooLarge }),
    );
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Accept-Language', i18n.language);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', enc(file.name));
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onerror = () => reject(new ApiError(`POST ${path} failed (network error)`, 0));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(
          new ApiError(
            `POST ${path} failed (HTTP ${xhr.status})`,
            xhr.status,
            parseJson(xhr.responseText),
          ),
        );
    };
    xhr.send(file);
  });
}

export function deleteRecording(itemId: string): Promise<undefined> {
  return apiSend('DELETE', `/knowledge/${enc(itemId)}/recording`);
}

/** "Spracovať s AI": 202, or 400 `nothing_to_process`, 409 `meeting_busy`, 503, 429. */
export function processMeeting(itemId: string): Promise<undefined> {
  return apiSend('POST', `/knowledge/${enc(itemId)}/meeting/process`);
}

/** The text of a .txt, .vtt, .srt or .docx file (the server reads it and keeps nothing). */
export async function transcriptFromFile(file: File): Promise<string> {
  if (file.size > MEETING_LIMITS.transcriptFileBytes) {
    throw new ApiError('Transcript file is too large', 413, { error: ErrorCodes.fileTooLarge });
  }
  const res = await fetch('/api/knowledge/transcript-text', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Accept-Language': i18n.language,
      'Content-Type': 'application/octet-stream',
      'X-File-Name': enc(file.name),
    },
    body: file,
  });
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(`Transcript file failed (HTTP ${res.status})`, res.status, body);
  return TranscriptTextSchema.parse(body).text;
}
