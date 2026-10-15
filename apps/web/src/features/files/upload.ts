import { FileInfoSchema, type FileInfo } from '@spolu/shared';
import { ApiError } from '@/lib/api';
import { i18n } from '@/i18n';
import { resizeImageWithSize } from '@/lib/resize-image';

/** Same limit as the server (`MAX_FILE_BYTES`): checked first so a big file is never sent. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const PREVIEW_SIDE = 640;
const PREVIEW_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function send(
  groupId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<FileInfo> {
  return new Promise((resolve, reject) => {
    const path = `/groups/${encodeURIComponent(groupId)}/files`;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Accept-Language', i18n.language);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onerror = () => reject(new ApiError(`POST ${path} failed (network error)`, 0));
    xhr.onload = () => {
      const body = parseJson(xhr.responseText);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(`POST ${path} failed (HTTP ${xhr.status})`, xhr.status, body));
        return;
      }
      const parsed = FileInfoSchema.safeParse(body);
      if (!parsed.success) {
        reject(new ApiError(`Response from ${path} does not match the expected shape`, xhr.status));
        return;
      }
      resolve(parsed.data);
    };
    xhr.send(file);
  });
}

/** Make and upload a 640 px WebP preview. Browsers that cannot encode WebP send none. */
async function uploadPreview(info: FileInfo, file: File): Promise<FileInfo> {
  const { blob, width, height } = await resizeImageWithSize(file, PREVIEW_SIDE);
  if (blob.type !== 'image/webp') return info;
  const path = `/files/${encodeURIComponent(info.id)}/preview`;
  const res = await fetch(`/api${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Accept-Language': i18n.language,
      'Content-Type': 'image/webp',
      'x-image-width': String(width),
      'x-image-height': String(height),
    },
    body: blob,
  });
  if (!res.ok) return info;
  return { ...info, hasPreview: true, width, height };
}

/**
 * Upload `file` to a group. `onProgress` gets the sent fraction (0..1). Rejects with ApiError
 * (status 0 for a network error; code `file_too_large` for a file over 25 MB). A PNG, JPEG or
 * WebP also gets a browser-made preview; a preview that fails is ignored, the upload succeeded.
 */
export async function uploadFile(
  groupId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<FileInfo> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ApiError('File is too large (over 25 MB)', 413, { error: 'file_too_large' });
  }
  const info = await send(groupId, file, onProgress);
  if (!PREVIEW_MIMES.has(info.mime)) return info;
  try {
    return await uploadPreview(info, file);
  } catch {
    return info;
  }
}
