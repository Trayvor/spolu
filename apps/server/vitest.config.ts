import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Run alone, after the rest, by `vitest.explain.config.ts` (see there).
    exclude: [...configDefaults.exclude, 'src/**/explain.test.ts'],
    globalSetup: ['test/setup-db.ts'],
    // Integration tests share one database, and a ticket without a client notifies every admin
    // the run has created: under load (other runs on the machine) single tests passed 5 s.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
