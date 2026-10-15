import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppDeps } from '../src/deps.js';
import type { Config } from '../src/infra/config/config.js';
import { createDb } from '../src/infra/db/client.js';
import { createEmailSender, emailJobHandlers } from '../src/infra/email/index.js';
import { createInlineJobs } from '../src/infra/jobs/inline-jobs.js';
import { createDiskStorage } from '../src/infra/storage/index.js';
import { testConfig } from './test-config.js';

/** A full app on the test database: SMTP to Mailpit, temp-dir storage, jobs run inline. */
export async function buildTestApp(
  overrides: { config?: Partial<Config> } = {},
): Promise<{ app: FastifyInstance; deps: AppDeps; close(): Promise<void> }> {
  const config = testConfig(overrides.config);
  const { db, close: closeDb } = createDb(config.databaseUrl);
  const filesDir = await mkdtemp(join(tmpdir(), 'spolu-test-'));
  const email = createEmailSender(config.email);
  const deps: AppDeps = {
    config,
    db,
    email,
    storage: createDiskStorage(filesDir, config.appSecret),
    jobs: createInlineJobs(emailJobHandlers(email)),
  };
  const app = await buildApp(deps);
  return {
    app,
    deps,
    async close() {
      await closeDb();
      await rm(filesDir, { recursive: true, force: true });
    },
  };
}
