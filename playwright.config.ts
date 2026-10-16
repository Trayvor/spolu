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
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/superadmin.json' },
    },
  ],
  webServer: {
    command: 'node e2e/create-db.mjs && pnpm -r build && node apps/server/dist/main.js',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NODE_ENV: 'production',
      PUSH_PROVIDER: 'fake', // sends are recorded to PUSH_FAKE_FILE, nothing leaves the machine
      PUSH_ALLOW_FAKE: '1', // the e2e server may use PUSH_PROVIDER=fake despite production
      PUSH_FAKE_FILE: resolve('data/e2e-push.jsonl'),
      // 10 s, not 10 minutes: long enough for the digest test's three messages to be delivered
      // before the batch is emailed, short enough for a 30 s poll.
      EMAIL_BATCH_DELAY_MS: '10000',
      // Every e2e browser logs in from 127.0.0.1: the production limit of 10 a minute would
      // refuse codes once the parallel specs log in more than that.
      LOGIN_CODES_PER_MINUTE: '200',
      // The same for invite-link joins, which the specs post from 127.0.0.1 too.
      JOIN_REQUESTS_PER_MINUTE: '200',
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
      // The canned task splitter; production mode refuses it without AI_ALLOW_FAKE=1.
      AI_PROVIDER: 'fake',
      // The ticket intake API (Phase 21); the specs post tickets with this key.
      TICKETS_API_KEY: 'e2e-tickets-key-0123456789',
      AI_ALLOW_FAKE: '1',
    },
  },
});
