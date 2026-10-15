import { cp } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  // Workspace packages are TypeScript source, so they are bundled; npm dependencies stay external.
  noExternal: ['@ehub/shared'],
  // runMigrations resolves ./migrations next to the running file: src/infra/db/ in dev, dist/ in the bundle.
  onSuccess: async () => {
    await cp('src/infra/db/migrations', 'dist/migrations', { recursive: true });
  },
});
