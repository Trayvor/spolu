import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaManifest } from './pwa-manifest.js';
import { lazyLanguageChunk, lazyLanguageGlobs } from './pwa-precache.js';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable PWA. The service worker precaches the app shell (index.html, hashed JS/CSS),
    // the fonts and the icons, and updates itself silently when a new build is deployed.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['brand/favicon.svg', 'brand/egrant-logo.svg', 'fonts/*.woff2'],
      manifest: pwaManifest,
      workbox: {
        // Push and notification-click handlers live in public/push-sw.js, outside the generated
        // worker; the notification buttons (N6a, ADR 0047) in public/push-actions.js, loaded first.
        importScripts: ['/push-actions.js', '/push-sw.js'],
        globPatterns: ['**/*.{js,css,html}'],
        // The seven lazy languages' texts are cached on first use, not precached (see
        // pwa-precache.ts). Hashed names never change content, so the cache never goes stale.
        globIgnores: lazyLanguageGlobs,
        runtimeCaching: [
          {
            // A RegExp, not a function: the plugin writes it into the generated worker.
            urlPattern: lazyLanguageChunk,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lazy-languages',
              // Old builds' chunks drop out once newer ones fill it.
              expiration: { maxEntries: 400 },
            },
          },
        ],
        navigateFallback: '/index.html',
        // API calls and the WebSocket must always reach the server, never the cached shell.
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/, /^\/files/],
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: { outDir: 'dist' },
});
