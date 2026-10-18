// The CSP has no 'unsafe-eval' (ADR 0044). zod's object parser probes `new Function` to compile
// a fast path; the probe is caught, but the browser still reports it as a violation. `jitless`
// skips the probe. zod keeps its config on `globalThis.__zod_globalConfig` (shared by every copy
// of zod), so setting it here costs no zod import in the initial JS; zod itself stays lazy.
// It must run before any schema module is evaluated: main.tsx imports this first.
// zod-jitless.test.ts checks that zod still reads it there.
const scope = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
(scope.__zod_globalConfig ??= {}).jitless = true;

export {};
