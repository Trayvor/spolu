import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The seal between finance and projects (Phase 33 part P6, decision 25; ADR 0027): the projects
 * module never imports anything of finance (it calls merges' hooks through
 * `projects/merge-hooks.ts`, which finance registers); finance reads no table of the tasks,
 * tickets or projects modules — it keeps its own copies of project and event ids and asks those
 * modules' exported functions. `finance/schema.ts` alone names the tasks and tickets tables, for
 * its foreign keys. Test files are exempt (they seed rows).
 */
const modules = join(dirname(fileURLToPath(import.meta.url)), '..');

const sources = (dir: string) =>
  readdirSync(join(modules, dir))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'test-volume.ts')
    .map((f) => ({ file: `${dir}/${f}`, text: readFileSync(join(modules, dir, f), 'utf8') }));

const importsOf = (text: string) =>
  [...text.matchAll(/from\s+'([^']+)'/g), ...text.matchAll(/import\(\s*'([^']+)'\s*\)/g)].map(
    (m) => m[1]!,
  );

describe('the finance seal', () => {
  it('the projects module imports nothing of finance', () => {
    const found = sources('projects').flatMap(({ file, text }) =>
      importsOf(text)
        .filter((path) => path.includes('/finance/'))
        .map((path) => `${file} -> ${path}`),
    );
    expect(found).toEqual([]);
  });

  it('finance imports no schema of tasks, tickets or projects outside its own schema', () => {
    const found = sources('finance')
      .filter(({ file }) => file !== 'finance/schema.ts')
      .flatMap(({ file, text }) =>
        importsOf(text)
          .filter((path) => /\.\.\/(tasks|tickets|projects)\/schema\.js$/.test(path))
          .map((path) => `${file} -> ${path}`),
      );
    expect(found).toEqual([]);
  });

  it('finance’s own schema names no projects table (it keeps copies, without foreign keys)', () => {
    const schema = sources('finance').find(({ file }) => file === 'finance/schema.ts')!;
    expect(importsOf(schema.text).filter((p) => p.includes('/projects/'))).toEqual([]);
  });

  it('finance’s SQL reads no tasks, tickets or projects table', () => {
    const tables = ['tasks', 'task_assignees', 'tickets', 'ticket_assignees', 'projects'];
    const pattern = new RegExp(`\\b(from|join)\\s+"?(${tables.join('|')}|project_\\w+)"?\\b`, 'i');
    const found = sources('finance').flatMap(({ file, text }) =>
      text
        .split('\n')
        .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
        .filter((line) => pattern.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(found).toEqual([]);
  });
});
