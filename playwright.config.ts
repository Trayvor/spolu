import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

// Production-like run: build everything, then serve the built web app from the built server.
// The e2e run uses its own database, spolu_e2e, created by e2e/create-db.mjs before the server starts.
// Needs the dev services: docker compose -f docker-compose.dev.yml up -d --wait
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    // Fixed browser locale so the default UI language (Slovak) is deterministic.
    locale: 'sk-SK',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/create-db.mjs && pnpm -r build && node apps/server/dist/main.js',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      PUBLIC_URL: baseURL,
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu_e2e',
      SUPERADMIN_EMAIL: 'admin@example.com',
      APP_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
      FILES_DIR: resolve('data/e2e-files'),
      WEB_DIST_DIR: resolve('apps/web/dist'),
      EMAIL_DRIVER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      MAIL_FROM: 'Spolu <noreply@localhost>',
    },
  },
});
