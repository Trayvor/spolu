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
    appSecret: 'x'.repeat(32),
    appVersion: 'test-sha',
    filesDir: './data/files',
    webDistDir: undefined,
    email: { driver: 'smtp', host: 'localhost', port: 1025, from: 'Spolu <noreply@example.com>' },
    ...overrides,
  };
}
