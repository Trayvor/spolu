import { z } from 'zod';
import { IdSchema, type McpScope, type SessionUser } from '@spolu/shared';
import type { ApiCaller, ApiResult } from '../call.js';

/**
 * The shape of an MCP tool (spec §5). A tool validates its arguments with its zod `input` (the
 * shared body schemas for writes), then calls one or two `/api` routes through `api`, as the
 * token's user. It never reads a table.
 */
export type ToolContext = { user: SessionUser; scope: McpScope; api: ApiCaller };

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | {
      type: 'resource';
      resource: { uri: string; mimeType: string; blob?: string; text?: string };
    };

/** What a tool ends with: the route's status, and the data (JSON) or ready content. */
export type ToolOutcome = {
  status: number;
  data?: unknown;
  content?: ToolContent[];
  /** The id the write acted on, for the audit (default: the tool's `target`). */
  targetId?: string | null;
};

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  title: string;
  description: string;
  input: S;
  /** A write tool: `write` tokens only, audited. */
  write?: boolean;
  /** A finance tool: finance holders only. */
  finance?: boolean;
  /** The id a write acts on, from the arguments (for the audit). */
  target?: (args: z.output<S>) => string | null;
  /** `raw` is the arguments as the client sent them: bodies go to the routes unchanged. */
  run: (ctx: ToolContext, args: z.output<S>, raw: Record<string, unknown>) => Promise<ToolOutcome>;
};

export function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

/** An id argument (a uuid or a short token, as the routes take). */
export const idArg = (what: string) => IdSchema.describe(`The ${what}'s id`);

/** Optional cursor of a paged list, from the previous answer's `nextCursor`. */
export const cursorArg = z.string().min(1).max(1000).optional();

/** The route's answer as the tool's outcome. */
export function fromApi(res: ApiResult, map?: (body: unknown) => unknown): ToolOutcome {
  if (res.status >= 400 || !map) return { status: res.status, data: res.body };
  return { status: res.status, data: map(res.body) };
}

/** The query string fields that are set (strings, numbers, booleans as `1`). */
export function query(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === false) continue;
    out[key] = value === true ? '1' : String(value);
  }
  return out;
}

/** Drops keys from an object answer (e.g. `askTime`, which is about finance). */
export function omit(keys: string[]): (body: unknown) => unknown {
  return (body) => {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
    const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const key of keys) delete copy[key];
    return copy;
  };
}

/** A tool error for arguments a schema refused, with where and why (never the values). */
export function invalidArguments(error: z.ZodError): ToolOutcome {
  return {
    status: 400,
    data: {
      error: 'validation_failed',
      issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    },
  };
}

/** The `id` of a JSON answer (a created entity), else the fallback. */
export function idOf(body: unknown, fallback: string | null): string | null {
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : fallback;
}

/**
 * Edits a versioned entity (tasks, knowledge, projects, events): the `changes` go to the PATCH
 * as given. Without `updatedAt` the current version is read first (spec §2 #17).
 */
export async function patchVersioned(
  api: ApiCaller,
  readPath: string,
  changes: Record<string, unknown>,
  map?: (body: unknown) => unknown,
): Promise<ToolOutcome> {
  let body = changes;
  if (body.updatedAt === undefined) {
    const current = await api('GET', readPath);
    const updatedAt = (current.body as { updatedAt?: unknown } | null)?.updatedAt;
    if (current.status !== 200 || typeof updatedAt !== 'string') return fromApi(current);
    body = { ...changes, updatedAt };
  }
  return fromApi(await api('PATCH', readPath, { body }), map);
}
