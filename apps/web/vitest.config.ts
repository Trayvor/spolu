import { mergeConfig, defineConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Each file still runs in its own VM context, but the workers and their jsdom are reused:
      // with the default `forks` pool, jsdom was set up once per file, a third of the run
      // (43.5 s -> 17 s locally, Phase 27).
      pool: 'vmThreads',
      testTimeout: 15000,
      hookTimeout: 15000,
      // Off: the cache keys a module by its own source, but `import.meta.glob` in
      // src/i18n/namespaces.ts depends on the locale folders, so a new namespace (after a merge)
      // stayed unknown until the cache was deleted.
      fsModuleCache: false,
    },
  }),
);
