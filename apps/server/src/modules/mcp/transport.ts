import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { recordWriteCall } from './audit.js';
import { createApiCaller } from './call.js';
import { canCallTool, canUseMcp } from './policy.js';
import { authenticateToken, type TokenAuth } from './tokens.js';
import {
  invalidArguments,
  type ToolContent,
  type ToolDef,
  type ToolOutcome,
} from './tools/define.js';
import { ALL_TOOLS, TOOLS_BY_NAME } from './tools/index.js';

/**
 * The MCP endpoint (spec §4, ADR 0033): Streamable HTTP, stateless, JSON answers only. One POST
 * carries a JSON-RPC message (or an array of them); `initialize`, `ping`, `tools/list` and
 * `tools/call` are answered, notifications and responses get 202. No SSE stream, no session id:
 * GET and DELETE answer 405.
 */

/** Newest first: `initialize` answers the client's version when it is one of these. */
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
/** A tool answer longer than this is cut (spec §2 #16). */
export const MCP_MAX_TEXT = 100_000;

export const MCP_LIMITS_PER_MINUTE = { requests: 120, writes: 30, failedAuth: 30 } as const;

const INSTRUCTIONS = [
  'Help by eGrant (code name Spolu) is the eGrant team’s workspace with its clients: groups (one per client, plus the internal admin group), chats, task boards, support tickets, knowledge (notes, files, meetings), projects with events, bulk email, and finance documents.',
  'You act as the user who made the token, with exactly their permissions: what they may not see answers 404, what they may not change 403.',
  'Start with whoami and list_groups; every other tool takes the ids they return. Lists are paged: pass the answer’s nextCursor (or the named cursor) back.',
  'Writes appear in the app at once and notify people as if the user did them. There are no delete tools.',
  'Finance is documents only (titles, texts, files, contract numbers and periods); no amounts, time or rates.',
].join(' ');

type JsonRpcId = string | number;
type JsonRpcMessage = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId | null; error: { code: number; message: string } };

const PARSE_ERROR = Symbol('parse error');

const rpcError = (id: JsonRpcId | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

/** The JSON Schema of each tool's arguments, built once from its zod schema. */
const schemas = new Map<string, Record<string, unknown>>();
function inputSchema(tool: ToolDef): Record<string, unknown> {
  let schema = schemas.get(tool.name);
  if (!schema) {
    schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >;
    delete schema.$schema;
    schemas.set(tool.name, schema);
  }
  return schema;
}

function describeTool(tool: ToolDef) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: inputSchema(tool),
    annotations: {
      title: tool.title,
      readOnlyHint: !tool.write,
      destructiveHint: false,
      idempotentHint: !tool.write,
      openWorldHint: false,
    },
  };
}

/** Cuts a long text answer, saying so (spec §2 #16). */
export function capText(text: string): string {
  if (text.length <= MCP_MAX_TEXT) return text;
  return `${text.slice(0, MCP_MAX_TEXT)}\n…[cut: the answer had ${text.length} characters; narrow the query or use the paging cursor]`;
}

function toToolResult(outcome: ToolOutcome): { content: ToolContent[]; isError: boolean } {
  const isError = outcome.status >= 400;
  if (outcome.content) return { content: outcome.content, isError };
  const data =
    isError && outcome.data !== null && typeof outcome.data === 'object'
      ? { status: outcome.status, ...(outcome.data as Record<string, unknown>) }
      : isError
        ? { status: outcome.status }
        : (outcome.data ?? null);
  return { content: [{ type: 'text', text: capText(JSON.stringify(data)) }], isError };
}

const toolError = (status: number, error: string, detail?: string) =>
  toToolResult({ status, data: detail ? { error, detail } : { error } });

export const mcpTransportRoutes: FastifyPluginAsync<{
  deps: AppDeps;
  root: FastifyInstance;
}> = async (app, { deps, root }) => {
  const { db } = deps;
  const allowRequest = createRateLimiter({ windowMs: 60_000, max: MCP_LIMITS_PER_MINUTE.requests });
  const allowWrite = createRateLimiter({ windowMs: 60_000, max: MCP_LIMITS_PER_MINUTE.writes });
  const allowFailure = createRateLimiter({
    windowMs: 60_000,
    max: MCP_LIMITS_PER_MINUTE.failedAuth,
  });
  const allowedOrigins = new Set([new URL(deps.config.publicUrl).origin]);

  // Our own JSON parser here, so a malformed body answers JSON-RPC's parse error.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, PARSE_ERROR);
    }
  });

  const visibleTools = (auth: TokenAuth) =>
    ALL_TOOLS.filter((tool) => canCallTool(auth.user, auth.scope, tool));

  async function callTool(
    auth: TokenAuth,
    ip: string,
    params: unknown,
    log: FastifyBaseLogger,
  ): Promise<unknown> {
    const { name, arguments: rawArgs } = (params ?? {}) as { name?: unknown; arguments?: unknown };
    const tool = typeof name === 'string' ? TOOLS_BY_NAME.get(name) : undefined;
    if (!tool) return null; // the caller answers -32602
    const args =
      rawArgs !== null && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    const audit = (status: number, targetId: string | null) =>
      tool.write
        ? recordWriteCall(db, {
            userId: auth.user.id,
            tokenId: auth.tokenId,
            tool: tool.name,
            targetId,
            status,
          })
        : Promise.resolve();
    const started = Date.now();
    const finish = async (status: number, targetId: string | null) => {
      await audit(status, targetId);
      log.info(
        { mcpTool: tool.name, userId: auth.user.id, status, ms: Date.now() - started },
        'mcp tool call',
      );
    };

    if (!canCallTool(auth.user, auth.scope, tool)) {
      await finish(403, null);
      return toolError(
        403,
        'forbidden',
        tool.write && auth.scope !== 'write' ? 'read-only token' : 'not allowed for this user',
      );
    }
    if (tool.write && !allowWrite(auth.tokenId)) {
      await finish(429, null);
      return toolError(429, 'rate_limited');
    }
    const parsed = tool.input.safeParse(args);
    if (!parsed.success) {
      await finish(400, null);
      return toToolResult(invalidArguments(parsed.error));
    }
    let outcome: ToolOutcome;
    try {
      outcome = await tool.run(
        { user: auth.user, scope: auth.scope, api: createApiCaller(root, auth.user, ip) },
        parsed.data,
        args,
      );
    } catch (error) {
      log.error({ err: error, mcpTool: tool.name }, 'mcp tool failed');
      await finish(500, null);
      return toolError(500, 'internal_error');
    }
    const targetId =
      outcome.targetId !== undefined ? outcome.targetId : (tool.target?.(parsed.data) ?? null);
    await finish(outcome.status, targetId);
    return toToolResult(outcome);
  }

  async function handle(
    message: unknown,
    auth: TokenAuth,
    ip: string,
    log: FastifyBaseLogger,
  ): Promise<JsonRpcResponse | null> {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      return rpcError(null, -32600, 'Invalid Request');
    }
    const { jsonrpc, id, method, params } = message as JsonRpcMessage;
    const validId = typeof id === 'string' || typeof id === 'number';
    // A response or a notification from the client: nothing to answer.
    if (method === undefined && ('result' in message || 'error' in message)) return null;
    if (jsonrpc !== '2.0' || typeof method !== 'string') {
      return rpcError(validId ? id : null, -32600, 'Invalid Request');
    }
    if (id === undefined) return null; // a notification (notifications/initialized, …)
    if (!validId) return rpcError(null, -32600, 'Invalid Request');

    switch (method) {
      case 'initialize': {
        const asked = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
        const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly unknown[]).includes(asked)
          ? asked
          : MCP_PROTOCOL_VERSIONS[0];
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'spolu', title: 'Help by eGrant', version: '1.0.0' },
            instructions: INSTRUCTIONS,
          },
        };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: visibleTools(auth).map(describeTool) } };
      case 'tools/call': {
        const result = await callTool(auth, ip, params, log);
        if (result === null) return rpcError(id, -32602, 'Unknown tool');
        return { jsonrpc: '2.0', id, result };
      }
      default:
        return rpcError(id, -32601, 'Method not found');
    }
  }

  const unauthorized = (reply: FastifyReply) =>
    reply
      .code(401)
      .header('www-authenticate', 'Bearer realm="spolu"')
      .send({ error: 'unauthorized' });

  app.post('/mcp', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const version = request.headers['mcp-protocol-version'];
    if (
      version !== undefined &&
      !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(String(version))
    ) {
      return reply.code(400).send({ error: 'unsupported_protocol_version' });
    }

    const header = request.headers.authorization ?? '';
    const raw = /^Bearer (\S+)$/i.exec(header)?.[1];
    const auth = raw ? await authenticateToken(db, raw) : null;
    if (!auth) {
      if (!allowFailure(request.ip)) return reply.code(429).send({ error: 'rate_limited' });
      return unauthorized(reply);
    }
    if (!canUseMcp(auth.user)) return reply.code(403).send({ error: 'forbidden' });
    if (!allowRequest(auth.tokenId)) return reply.code(429).send({ error: 'rate_limited' });

    const body = request.body;
    if (body === PARSE_ERROR || body === undefined) {
      return reply.code(400).send(rpcError(null, -32700, 'Parse error'));
    }
    if (Array.isArray(body)) {
      if (body.length === 0) return reply.code(400).send(rpcError(null, -32600, 'Invalid Request'));
      const answers: JsonRpcResponse[] = [];
      for (const message of body) {
        const answer = await handle(message, auth, request.ip, request.log);
        if (answer) answers.push(answer);
      }
      return answers.length === 0 ? reply.code(202).send() : reply.send(answers);
    }
    const answer = await handle(body, auth, request.ip, request.log);
    return answer ? reply.send(answer) : reply.code(202).send();
  });

  // No server-to-client stream and no sessions (stateless).
  const notAllowed = async (_request: unknown, reply: FastifyReply) =>
    reply.code(405).header('allow', 'POST').send({ error: 'method_not_allowed' });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
};
