import type { Config } from '../src/infra/config/config.js';

export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu_test';

/** A valid Config for tests; override fields as needed. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    port: 0,
    publicUrl: 'http://localhost:3000',
    databaseUrl: testDatabaseUrl,
    superadminEmail: 'admin@example.com',
    superadminName: 'admin',
    appSecret: 'x'.repeat(32),
    appVersion: 'test-sha',
    filesDir: './data/files',
    webDistDir: undefined,
    email: {
      driver: 'smtp',
      host: '127.0.0.1',
      port: 1025,
      secure: false,
      from: 'Spolu <noreply@example.com>',
    },
    push: { provider: 'fake', publicKey: 'test-vapid-public-key', file: undefined },
    emailBatchDelayMs: 600_000,
    loginCodesPerMinute: 10,
    joinRequestsPerMinute: 10,
    ai: null,
    ticketsApiKey: null,
    ...overrides,
  };
}
