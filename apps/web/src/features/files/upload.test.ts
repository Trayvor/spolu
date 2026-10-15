import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileInfo } from '@spolu/shared';
import { ApiError } from '@/lib/api';
import { resizeImageWithSize } from '@/lib/resize-image';
import { uploadFile } from './upload';

vi.mock('@/lib/resize-image', () => ({ resizeImageWithSize: vi.fn() }));

class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  withCredentials = false;
  headers: Record<string, string> = {};
  sent: unknown;
  status = 0;
  responseText = '';
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.sent = body;
  }
  reply(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

const info = (mime: string): FileInfo => ({
  id: 'f1',
  name: 'a b.png',
  mime,
  size: 5,
  width: null,
  height: null,
  hasPreview: false,
});
const file = (type = 'image/png', name = 'a b.png') => new File(['bytes'], name, { type });
const tick = () => new Promise((r) => setTimeout(r, 0));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(resizeImageWithSize).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('uploadFile', () => {
  it('sends the file with encoded name and type and resolves FileInfo', async () => {
    const f = file('application/pdf', 'Zpráva 1.pdf');
    const promise = uploadFile('g 1', f);
    const x = FakeXhr.last;
    expect(x.method).toBe('POST');
    expect(x.url).toBe('/api/groups/g%201/files');
    expect(x.withCredentials).toBe(true);
    expect(x.headers['Content-Type']).toBe('application/pdf');
    expect(x.headers['X-File-Name']).toBe(encodeURIComponent('Zpráva 1.pdf'));
    expect(x.headers.Accept).toBe('application/json');
    expect(x.headers['Accept-Language']).toBeTruthy();
    expect(x.sent).toBe(f);
    x.reply(201, info('application/pdf'));
    expect(await promise).toEqual(info('application/pdf'));
  });

  it('falls back to application/octet-stream without a type', async () => {
    const promise = uploadFile('g1', file('', 'x.bin'));
    expect(FakeXhr.last.headers['Content-Type']).toBe('application/octet-stream');
    FakeXhr.last.reply(201, info('application/octet-stream'));
    await promise;
  });

  it('reports progress fractions', async () => {
    const onProgress = vi.fn();
    const promise = uploadFile('g1', file('application/pdf'), onProgress);
    FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    FakeXhr.last.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 4 });
    expect(onProgress.mock.calls).toEqual([[0.25], [1]]);
    FakeXhr.last.reply(201, info('application/pdf'));
    await promise;
  });

  it('413 rejects with ApiError code file_too_large', async () => {
    const promise = uploadFile('g1', file('application/pdf'));
    FakeXhr.last.reply(413, { error: 'file_too_large' });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(413);
    expect((error as ApiError).code).toBe('file_too_large');
  });

  it('rejects a file over 25 MB without sending it', async () => {
    const big = file('application/pdf');
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 + 1 });
    FakeXhr.last = undefined as never;
    const error = await uploadFile('g1', big).catch((e: unknown) => e);
    expect((error as ApiError).code).toBe('file_too_large');
    expect(FakeXhr.last).toBeUndefined();
  });

  it('a network error rejects with ApiError status 0', async () => {
    const promise = uploadFile('g1', file('application/pdf'));
    FakeXhr.last.onerror?.();
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });

  it('an image gets a 640 px WebP preview PUT with width/height headers and resolves hasPreview true', async () => {
    const blob = new Blob(['w'], { type: 'image/webp' });
    vi.mocked(resizeImageWithSize).mockResolvedValue({ blob, width: 1600, height: 900 });
    const f = file();
    const promise = uploadFile('g1', f);
    FakeXhr.last.reply(201, info('image/png'));
    const result = await promise;
    expect(resizeImageWithSize).toHaveBeenCalledWith(f, 640);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/files/f1/preview');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(blob);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-image-width']).toBe('1600');
    expect(headers['x-image-height']).toBe('900');
    expect(headers['Content-Type']).toBe('image/webp');
    expect(result).toMatchObject({ id: 'f1', hasPreview: true, width: 1600, height: 900 });
  });

  it('a failed preview still resolves the uploaded FileInfo with hasPreview false', async () => {
    vi.mocked(resizeImageWithSize).mockResolvedValue({
      blob: new Blob(['w'], { type: 'image/webp' }),
      width: 10,
      height: 10,
    });
    fetchMock.mockResolvedValue(new Response('{}', { status: 400 }));
    const promise = uploadFile('g1', file());
    FakeXhr.last.reply(201, info('image/png'));
    expect(await promise).toEqual(info('image/png'));

    vi.mocked(resizeImageWithSize).mockRejectedValue(new Error('decode'));
    const second = uploadFile('g1', file());
    FakeXhr.last.reply(201, info('image/png'));
    expect((await second).hasPreview).toBe(false);
  });

  it('sends no preview when the browser cannot encode WebP', async () => {
    vi.mocked(resizeImageWithSize).mockResolvedValue({
      blob: new Blob(['p'], { type: 'image/png' }),
      width: 10,
      height: 10,
    });
    const promise = uploadFile('g1', file());
    FakeXhr.last.reply(201, info('image/png'));
    expect((await promise).hasPreview).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a PDF sends no preview', async () => {
    const promise = uploadFile('g1', file('application/pdf'));
    FakeXhr.last.reply(201, info('application/pdf'));
    await promise;
    await tick();
    expect(resizeImageWithSize).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
