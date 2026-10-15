import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable PWA. The service worker precaches the app shell (index.html, hashed JS/CSS),
    // the fonts and the icons, and updates itself silently when a new build is deployed.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['brand/favicon.svg', 'brand/egrant-logo.svg', 'fonts/*.woff2'],
      manifest: {
        id: '/',
        name: 'Spolu by eGrant',
        short_name: 'Spolu',
        description: 'Client communication by eGrant',
        lang: 'sk',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        // Page base color, so the browser bar blends with the light header (docs/design/tokens.md).
        theme_color: '#F5F3F1',
        background_color: '#F5F3F1',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html}'],
        navigateFallback: '/index.html',
        // API calls and the WebSocket must always reach the server, never the cached shell.
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
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
