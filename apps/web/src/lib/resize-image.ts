/** Longest side of a stored logo, in px. */
export const LOGO_MAX_SIDE = 256;

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Files above this are rejected before decoding (a huge image can exhaust memory). */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/**
 * Shrink an image so its longest side fits `max` px (aspect ratio kept, never upscaled) and
 * encode it as WebP at 0.85. A browser that cannot encode WebP answers PNG (or nothing) for
 * that request, so fall back to PNG. The blob's `type` is what to send as Content-Type.
 * Rejects for a file that is not an image, is over 20 MB, or cannot be decoded.
 * Also answers the original bitmap's width and height (before shrinking).
 */
export async function resizeImageWithSize(
  file: File,
  max: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith('image/')) throw new Error('Not an image');
  if (file.size > MAX_INPUT_BYTES) throw new Error('Image is too large');
  const bitmap = await createImageBitmap(file);
  let scaled: ImageBitmap | null = null;
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const original = { width: bitmap.width, height: bitmap.height };
    // The browser's own high quality resampling beats drawImage's default for big reductions.
    if (scale < 1) {
      scaled = await createImageBitmap(bitmap, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'high',
      });
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available');
    context.drawImage(scaled ?? bitmap, 0, 0, width, height);

    const webp = await encode(canvas, 'image/webp', 0.85);
    if (webp?.type === 'image/webp') return { blob: webp, ...original };
    const png = await encode(canvas, 'image/png');
    if (!png) throw new Error('Could not encode the image');
    return { blob: png, ...original };
  } finally {
    scaled?.close();
    bitmap.close();
  }
}

/** `resizeImageWithSize` without the original size: the blob only. */
export async function resizeImage(file: File, max = LOGO_MAX_SIDE): Promise<Blob> {
  return (await resizeImageWithSize(file, max)).blob;
}
