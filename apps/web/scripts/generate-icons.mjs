/* global URL, console -- Node globals; ESLint has no Node environment set for plain .mjs scripts */
// Builds the PWA icons in public/icons/ from the egrant mark (public/brand/favicon.svg) and the
// email logo PNG public/brand/egrant-logo-email.png from public/brand/egrant-logo.svg.
// Run after the mark changes: `pnpm --filter @spolu/web icons`. The PNGs are committed.
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = `${root}public/brand/favicon.svg`;
const outDir = `${root}public/icons`;
const background = '#F5F3F1'; // egrant "base", same as the manifest background_color

// `markRatio` is the share of the canvas the mark takes. Maskable icons keep the mark
// inside the central safe zone (a circle of 80% diameter), so the mark is smaller there.
const icons = [
  { file: 'icon-192.png', size: 192, markRatio: 0.8 },
  { file: 'icon-512.png', size: 512, markRatio: 0.8 },
  { file: 'maskable-512.png', size: 512, markRatio: 0.5 },
  { file: 'apple-touch-180.png', size: 180, markRatio: 0.7 },
];

const svg = await readFile(source);
await mkdir(outDir, { recursive: true });

for (const { file, size, markRatio } of icons) {
  const markSize = Math.round(size * markRatio);
  const mark = await sharp(svg, { density: 300 }).resize(markSize, markSize).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: 'center' }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(`${outDir}/${file}`);
  console.log(`public/icons/${file} (${size}x${size})`);
}

// The eGrant logo for bulk emails (Phase 23): Gmail and Outlook do not show SVG, so the light
// logo is also written as a PNG, 360 px wide and shown at 180 px (sharp on high-density screens).
const logoSvg = await readFile(`${root}public/brand/egrant-logo.svg`);
const logoFile = 'egrant-logo-email.png';
const logo = await sharp(logoSvg, { density: 300 })
  .resize({ width: 360 })
  .png({ compressionLevel: 9, palette: true })
  .toFile(`${root}public/brand/${logoFile}`);
console.log(`public/brand/${logoFile} (${logo.width}x${logo.height})`);
