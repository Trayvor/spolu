import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaManifest } from './pwa-manifest.js';

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
        // Push and notification-click handlers live in public/push-sw.js, outside the generated worker.
        importScripts: ['/push-sw.js'],
        globPatterns: ['**/*.{js,css,html}'],
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
