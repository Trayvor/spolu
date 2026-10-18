import type { RawTask, TaskSplitProvider } from './provider.js';

// A list line: `- `, `* `, `• `, `1. ` or `1) ` at the start (indentation allowed).
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/u;
const DATE = /\d{4}-\d{2}-\d{2}/;
const URGENT = /urgent|súrne/iu;
const URL_IN_LINE = /https?:\/\/\S+/u;

/**
 * A deterministic stand-in for local development and e2e (`AI_PROVIDER=fake`), never for a
 * server: one task per list line; names and file names found in the line become assignees and
 * files, the first YYYY-MM-DD the deadline, "urgent"/"súrne" the urgent flag, the first web
 * address the link.
 */
export function createFakeProvider(): TaskSplitProvider {
  return {
    async split(request) {
      const tasks: RawTask[] = [];
      for (const line of request.text.split('\n')) {
        const title = LIST_LINE.exec(line)?.[1]?.trim();
        if (!title) continue;
        const lower = line.toLowerCase();
        const has = (name: string) => name.trim() !== '' && lower.includes(name.toLowerCase());
        tasks.push({
          title,
          description: '',
          assigneeIds: request.people.filter((p) => has(p.name)).map((p) => p.id),
          fileIds: request.files.filter((f) => has(f.name)).map((f) => f.id),
          deadline: DATE.exec(line)?.[0] ?? null,
          urgent: URGENT.test(line),
          link: URL_IN_LINE.exec(line)?.[0] ?? null,
        });
      }
      return { tasks, usage: null };
    },
  };
}
