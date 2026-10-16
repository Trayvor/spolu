import type { ManifestOptions } from 'vite-plugin-pwa';

/** The web app manifest. The page base color keeps the browser bar blending with the light header. */
export const pwaManifest: Partial<ManifestOptions> = {
  id: '/',
  name: 'Spolu by eGrant',
  short_name: 'Spolu',
  description: 'Client communication by eGrant',
  lang: 'sk',
  display: 'standalone',
  start_url: '/',
  scope: '/',
  // Page base color (docs/design/tokens.md).
  theme_color: '#F5F3F1',
  background_color: '#F5F3F1',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
