import { defineConfig } from 'vitest/config';

// The EXPLAIN checks (`modules/home/explain.test.ts`) run on their own, after the main suite,
// on a fresh database of their own (`test/setup-explain-db.ts`): with every other test file
// writing at once, and thousands of leftover groups in the shared test database, their 50 ms
// bound would measure noise.
export default defineConfig({
  test: { include: ['src/**/explain.test.ts'], globalSetup: ['test/setup-explain-db.ts'] },
});
