/** Longest side of a stored logo, in px. */
export const LOGO_MAX_SIDE = 256;

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Shrink an image so its longest side fits `max` px (aspect ratio kept, never upscaled) and
 * encode it as WebP at 0.85. A browser that cannot encode WebP answers PNG (or nothing) for
 * that request, so fall back to PNG. The blob's `type` is what to send as Content-Type.
 * Rejects for a file that is not an image or cannot be decoded.
 */
export async function resizeImage(file: File, max = LOGO_MAX_SIDE): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Not an image');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const webp = await encode(canvas, 'image/webp', 0.85);
    if (webp?.type === 'image/webp') return webp;
    const png = await encode(canvas, 'image/png');
    if (!png) throw new Error('Could not encode the image');
    return png;
  } finally {
    bitmap.close();
  }
}
