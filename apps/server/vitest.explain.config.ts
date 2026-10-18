import { defineConfig } from 'vitest/config';

// The EXPLAIN checks (`modules/*/explain.test.ts`) run on their own, after the main suite. Each
// file reads its own clone of its volume's template database (`test/setup-explain-db.ts`,
// ADR 0040): the seeded volume is the whole data set, committed and vacuumed, with no dead tuples
// and no GIN pending list. The clones are separate databases, so the files may run at once: no
// file's rows reach another file's heap, statistics or pending lists.
export default defineConfig({
  test: {
    include: ['src/**/explain.test.ts'],
    globalSetup: ['test/setup-explain-db.ts'],
  },
});
