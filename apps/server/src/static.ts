import { readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const ASSETS_DIR = 'assets';
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Serves the built web app and makes unknown client routes (e.g. /settings) fall back to index.html.
 * The fallback itself lives in the not-found handler in app.ts (Fastify allows only one).
 */
export async function registerStatic(app: FastifyInstance, webDistDir: string): Promise<void> {
  const indexHtml = await readFile(join(webDistDir, 'index.html'));

  await app.register(fastifyStatic, {
    root: webDistDir,
    index: 'index.html',
    cacheControl: false,
    // Vite fingerprints everything under /assets/, so it can be cached forever; the rest must revalidate.
    setHeaders: (reply, filePath) => {
      const isAsset = filePath.startsWith(join(webDistDir, ASSETS_DIR) + sep);
      reply.header('Cache-Control', isAsset ? IMMUTABLE : 'no-cache');
    },
  });

  app.spaFallback = (reply) =>
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(indexHtml);
}
