import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

/** The longer side of a logo rendered from SVG, in pixels (the shorter keeps the ratio). */
export const SVG_LOGO_SIZE = 512;

let ready: Promise<void> | undefined;

/** Loads the renderer's WebAssembly once, on the first SVG logo. */
const loadRenderer = () => {
  ready ??= (async () => {
    const path = createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm');
    await initWasm(await readFile(path));
  })().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  return ready;
};

/**
 * Renders an SVG logo (from the eGrant groups webhook) to a PNG whose longer side is
 * `SVG_LOGO_SIZE`, so the SVG itself is never stored or served (ADR 0039). The renderer is resvg
 * compiled to WebAssembly: it runs no scripts and has no access to the file system or the
 * network, so `<script>`, event handlers and external or local `href`s draw nothing. No fonts
 * are loaded, so text that is not converted to paths draws nothing either. Null when the bytes
 * are not a well-formed SVG with a size.
 */
export async function renderSvgLogo(bytes: Buffer): Promise<Buffer | null> {
  await loadRenderer();
  let svg: InstanceType<typeof Resvg> | undefined;
  try {
    // Parsed once to read its size, then once more fitted to the logo size.
    svg = new Resvg(bytes, { font: { loadSystemFonts: false } });
    const mode = svg.width >= svg.height ? 'width' : 'height';
    svg.free();
    svg = undefined;
    svg = new Resvg(bytes, {
      font: { loadSystemFonts: false },
      fitTo: { mode, value: SVG_LOGO_SIZE },
    });
    const image = svg.render();
    try {
      if (image.width < 1 || image.height < 1) return null;
      return Buffer.from(image.asPng());
    } finally {
      image.free();
    }
  } catch {
    // Not XML, not an SVG root, no size, or an unrenderable document.
    return null;
  } finally {
    svg?.free();
  }
}
