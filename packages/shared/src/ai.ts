// Limits of the AI task split. Its schemas are in `task-split.ts`, a module of its own so the
// web bundles them with the lazy screens that use them, not with every page.

/** At most this many task cards come back from one split. */
export const AI_MAX_TASKS = 10;
export const AI_TITLE_MAX = 200;
export const AI_DESCRIPTION_MAX = 5000;
