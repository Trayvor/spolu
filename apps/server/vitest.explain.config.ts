import { defineConfig } from 'vitest/config';

// The EXPLAIN checks (`modules/*/explain.test.ts`) run on their own, after the main suite,
// on a fresh database of their own (`test/setup-explain-db.ts`): with every other test file
// writing at once, and thousands of leftover groups in the shared test database, their 50 ms
// bound would measure noise.
//
// The files run one at a time. Each seeds a volume in a transaction, and several seed the same
// tables (`tickets`, `tasks`): rows another file inserts after a file's `analyze` and
// `gin_clean_pending_list` land in the shared GIN pending lists and the heap, which that file's
// planner then prices in (a full pending list makes the trigram indexes look dearer than a
// sequential scan), so its plans would depend on the other files' timing.
export default defineConfig({
  test: {
    include: ['src/**/explain.test.ts'],
    globalSetup: ['test/setup-explain-db.ts'],
    fileParallelism: false,
  },
});
