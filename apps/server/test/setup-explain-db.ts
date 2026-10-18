import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { FINANCE_VOLUME_TABLES, seedFinanceVolume } from '../src/modules/finance/test-volume.js';
import { HOME_VOLUME_TABLES, seedHomeVolume } from '../src/modules/home/test-volume.js';
import { PROJECT_VOLUME_TABLES, seedProjectVolume } from '../src/modules/projects/test-volume.js';
import { SEARCH_VOLUME_TABLES, seedSearchVolume } from '../src/modules/search/test-volume.js';
import { databaseUrl, ensureTemplate, type Volume } from './explain-templates.js';

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu';
const testUrl = process.env.TEST_DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu_test';

const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** One template per volume: home and projects seed the same tables at different scales. */
const VOLUMES = [
  {
    name: 'home',
    files: [file('../src/modules/home/test-volume.ts')],
    seed: seedHomeVolume,
    tables: HOME_VOLUME_TABLES,
  },
  {
    name: 'projects',
    files: [file('../src/modules/projects/test-volume.ts')],
    seed: seedProjectVolume,
    tables: PROJECT_VOLUME_TABLES,
  },
  {
    name: 'finance',
    files: [file('../src/modules/finance/test-volume.ts')],
    seed: seedFinanceVolume,
    tables: FINANCE_VOLUME_TABLES,
  },
  {
    name: 'search',
    files: [file('../src/modules/search/test-volume.ts')],
    seed: seedSearchVolume,
    tables: SEARCH_VOLUME_TABLES,
  },
] as const satisfies readonly Volume[];

export type ExplainVolume = (typeof VOLUMES)[number]['name'];

declare module 'vitest' {
  export interface ProvidedContext {
    /** The clone of each volume's template for this run (`inject('explainDatabaseUrls')`). */
    explainDatabaseUrls: Record<ExplainVolume, string>;
  }
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Vitest globalSetup of the EXPLAIN checks (ADR 0040): makes sure each volume's template exists
 * (`explain-templates.ts`, built on first use), then clones it into `<test database>_explain_<volume>`
 * with a file copy and provides the URLs to the tests. The clones are dropped after the run;
 * the templates stay for the next one.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const testName = new URL(testUrl).pathname.slice(1);
  const templates = await Promise.all(VOLUMES.map((volume) => ensureTemplate(adminUrl, volume)));
  const clones = VOLUMES.map((volume) => `${testName}_explain_${volume.name}`);
  const admin = postgres(adminUrl, { max: 3, connect_timeout: 5, onnotice: () => {} });
  const dropClones = () =>
    Promise.all(
      clones.map((clone) => admin.unsafe(`drop database if exists ${quote(clone)} with (force)`)),
    );
  try {
    // The single explain database of before ADR 0040, left by an older run.
    await admin.unsafe(`drop database if exists ${quote(`${testName}_explain`)} with (force)`);
    await dropClones();
    await Promise.all(
      clones.map((clone, i) =>
        admin.unsafe(
          `create database ${quote(clone)} template ${quote(templates[i]!)} strategy file_copy`,
        ),
      ),
    );
  } catch (error) {
    await admin.end({ timeout: 5 });
    throw error;
  }
  project.provide(
    'explainDatabaseUrls',
    Object.fromEntries(
      VOLUMES.map((volume, i) => [volume.name, databaseUrl(testUrl, clones[i]!)]),
    ) as Record<ExplainVolume, string>,
  );
  return async () => {
    try {
      await dropClones();
    } finally {
      await admin.end({ timeout: 5 });
    }
  };
}
