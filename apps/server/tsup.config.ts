import { cp } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  // media-sandbox: the entry point of the media sandbox container (ADR 0048).
  entry: ['src/main.ts', 'src/media-sandbox.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  clean: true,
  // Workspace packages are TypeScript source, so they are bundled; npm dependencies stay external.
  noExternal: ['@spolu/shared'],
  // runMigrations resolves ./migrations next to the running file: src/infra/db/ in dev, dist/ in the bundle.
  onSuccess: async () => {
    await cp('src/infra/db/migrations', 'dist/migrations', { recursive: true });
  },
});
