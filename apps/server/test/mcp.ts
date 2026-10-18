import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { McpScope } from '@spolu/shared';
import type { Db } from '../src/infra/db/client.js';
import { createToken } from '../src/modules/mcp/tokens.js';

/** A fresh MCP token of the user (the tokens service, as the settings route uses it). */
export async function mcpToken(db: Db, userId: string, scope: McpScope = 'write'): Promise<string> {
  return (await createToken(db, userId, { name: 'test', scope, expiresInDays: 7 })).token;
}

let nextId = 1;

/** One JSON-RPC request to `POST /mcp`. */
export function mcpRequest(
  app: FastifyInstance,
  token: string | null,
  method: string,
  params?: unknown,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    payload: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
}

export type ToolCallResult = {
  isError: boolean;
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  /** The first text content parsed as JSON (null when it is not JSON). */
  json: unknown;
  /** Every content as text (the texts decoded), for leak checks. */
  raw: string;
};

/** Calls a tool through `/mcp`; fails the test on a JSON-RPC error. */
export async function callTool(
  app: FastifyInstance,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResult> {
  const res = await mcpRequest(app, token, 'tools/call', { name, arguments: args });
  if (res.statusCode !== 200) throw new Error(`/mcp answered ${res.statusCode}: ${res.body}`);
  const body = res.json<{ result?: Omit<ToolCallResult, 'json' | 'raw'>; error?: unknown }>();
  if (!body.result) throw new Error(`JSON-RPC error: ${JSON.stringify(body.error)}`);
  const first = body.result.content.find((c) => c.type === 'text')?.text;
  let json: unknown;
  try {
    json = first === undefined ? null : JSON.parse(first);
  } catch {
    json = null;
  }
  // Decoded: the texts as the model reads them (JSON inside them is not escaped here).
  const raw = body.result.content
    .map((c) => (c.type === 'text' ? (c.text ?? '') : JSON.stringify(c)))
    .join('\n');
  return { ...body.result, json, raw };
}
