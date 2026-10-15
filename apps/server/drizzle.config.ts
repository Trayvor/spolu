import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // Module-owned tables live in src/modules/<name>/schema.ts and are picked up here.
  schema: './src/**/schema.ts',
  out: './src/infra/db/migrations',
});
