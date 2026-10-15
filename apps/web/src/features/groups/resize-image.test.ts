import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resizeImage } from './resize-image';

const drawImage = vi.fn();
let toBlobResult: (type: string) => Blob | null;
const toBlobCalls: [string, number | undefined][] = [];
/** The canvas the code under test drew on. */
const usedCanvas = () =>
  vi.mocked(HTMLCanvasElement.prototype.getContext).mock.contexts[0] as HTMLCanvasElement;

function stubImage(width: number, height: number) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close: vi.fn() })),
  );
}

beforeEach(() => {
  drawImage.mockClear();
  toBlobCalls.length = 0;
  toBlobResult = (type) => new Blob(['x'], { type });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb, type, quality) => {
    toBlobCalls.push([type ?? '', quality as number | undefined]);
    cb(toBlobResult(type ?? ''));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const file = (type = 'image/jpeg') => new File(['bytes'], 'logo', { type });

describe('resizeImage', () => {
  it('fits a landscape image into 256 px keeping the aspect ratio, as WebP 0.85', async () => {
    stubImage(1024, 512);
    const blob = await resizeImage(file());
    expect(usedCanvas().width).toBe(256);
    expect(usedCanvas().height).toBe(128);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 256, 128);
    expect(blob.type).toBe('image/webp');
    expect(toBlobCalls).toEqual([['image/webp', 0.85]]);
  });

  it('fits a portrait image by its height', async () => {
    stubImage(300, 600);
    await resizeImage(file());
    expect([usedCanvas().width, usedCanvas().height]).toEqual([128, 256]);
  });

  it('never upscales a small image', async () => {
    stubImage(100, 50);
    await resizeImage(file());
    expect([usedCanvas().width, usedCanvas().height]).toEqual([100, 50]);
  });

  it('falls back to PNG when WebP encoding is not supported', async () => {
    stubImage(400, 400);
    toBlobResult = (type) =>
      type === 'image/webp' ? new Blob(['x'], { type: 'image/png' }) : new Blob(['y'], { type });
    const blob = await resizeImage(file());
    expect(blob.type).toBe('image/png');
    expect(toBlobCalls.map(([type]) => type)).toEqual(['image/webp', 'image/png']);
  });

  it('falls back to PNG when toBlob answers null', async () => {
    stubImage(400, 400);
    toBlobResult = (type) => (type === 'image/webp' ? null : new Blob(['y'], { type }));
    expect((await resizeImage(file())).type).toBe('image/png');
  });

  it('rejects a file that is not an image', async () => {
    stubImage(10, 10);
    await expect(resizeImage(file('application/pdf'))).rejects.toThrow();
  });

  it('rejects when the image cannot be decoded', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad')));
    await expect(resizeImage(file('image/png'))).rejects.toThrow();
  });
});
