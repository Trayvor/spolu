import { defineConfig } from 'vitest/config';

// The EXPLAIN checks (`modules/*/explain.test.ts`) run on their own, after the main suite. Each
// file reads its own clone of its volume's template database (`test/setup-explain-db.ts`,
// ADR 0040): the seeded volume is the whole data set, committed and vacuumed, with no dead tuples
// and no GIN pending list. The clones are separate databases, so the files may run at once: no
// file's rows reach another file's heap, statistics or pending lists.
//
// With RUN_BENCH=1 the files run one at a time (2026-10-19): their time bounds count then, and
// files at once shared the database's CPUs and its 128 MB of shared buffers, so a query that
// takes 7 ms alone measured 70 ms next to the audit volume's 2 000 000 rows.
export default defineConfig({
  test: {
    include: ['src/**/explain.test.ts'],
    globalSetup: ['test/setup-explain-db.ts'],
    fileParallelism: !process.env.RUN_BENCH,
  },
});
