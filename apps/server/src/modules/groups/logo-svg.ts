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

/** An image element (`<image>`, `<feImage>`), with or without a namespace prefix. */
const IMAGE_ELEMENT = /<\s*([\w.-]+:)?(image|feimage)[\s/>]/i;
/** Every `href` or `xlink:href` (any prefix) attribute and its value. */
const HREF = /[\s"']([\w.-]+:)?href\s*=\s*(["'])(.*?)\2/gis;

/**
 * True when the SVG is safe to hand to the renderer (ADR 0039, 2026-10-18 note): no image
 * elements, no `data:` anywhere (not even in CSS), no entity declarations (they could expand to
 * any of these), and every `href` a plain local reference (`#id`). resvg decodes an embedded
 * image at full size on the main thread, so a small file could block the server for seconds
 * and hold gigabytes; these checks keep every image out before parsing starts.
 */
export function isRenderableSvg(bytes: Buffer): boolean {
  // resvg unzips a gzipped SVG (SVGZ) itself, which would hide its text from these checks.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return false;
  // Numeric character references are decoded first, so `&#100;ata:` is seen as `data:`.
  const text = bytes.toString('utf8').replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, ref: string) => {
    const code = ref[0] === 'x' || ref[0] === 'X' ? parseInt(ref.slice(1), 16) : Number(ref);
    return String.fromCodePoint(Math.min(code, 0x10ffff));
  });
  if (IMAGE_ELEMENT.test(text) || /(^|[^\w-])data\s*:/i.test(text) || /<!ENTITY/i.test(text)) {
    return false;
  }
  for (const [, , , value] of text.matchAll(HREF)) {
    if (!/^#[\w.:-]*$/.test(value!)) return false;
  }
  return true;
}

/**
 * Renders an SVG logo (from the eGrant groups webhook) to a PNG whose longer side is
 * `SVG_LOGO_SIZE`, so the SVG itself is never stored or served (ADR 0039). The renderer is resvg
 * compiled to WebAssembly: it runs no scripts and has no access to the file system or the
 * network, so `<script>` and event handlers draw nothing. No fonts are loaded, so text that is
 * not converted to paths draws nothing either. Null when the bytes are not a well-formed SVG
 * with a size, carry an image or an outside reference (`isRenderableSvg`), or declare a side
 * longer than `maxUnits`.
 */
export async function renderSvgLogo(bytes: Buffer, maxUnits: number): Promise<Buffer | null> {
  if (!isRenderableSvg(bytes)) return null;
  await loadRenderer();
  let svg: InstanceType<typeof Resvg> | undefined;
  try {
    // Parsed once to read its size, then once more fitted to the logo size.
    svg = new Resvg(bytes, { font: { loadSystemFonts: false } });
    if (Math.max(svg.width, svg.height) > maxUnits) return null;
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
