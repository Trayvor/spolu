import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Run alone, after the rest, by `vitest.explain.config.ts` (see there).
    exclude: [...configDefaults.exclude, 'src/**/explain.test.ts'],
    globalSetup: ['test/setup-db.ts'],
  },
});
