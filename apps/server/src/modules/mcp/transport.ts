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
 * carries a JSON-RPC message (in protocol 2025-03-26 also a batch of at most 10, each counted
 * against the rate limit; the answer is at most 5 MB); `initialize`, `ping`, `tools/list` and
 * `tools/call` are answered, notifications and responses get 202. No SSE stream, no session id:
 * GET and DELETE answer 405.
 */

/** Newest first: `initialize` answers the client's version when it is one of these. */
const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
/** A tool answer longer than this is cut (spec §2 #16). */
export const MCP_MAX_TEXT = 100_000;

/** Per user (all their tokens together); failed sign-ins per address. */
const MCP_LIMITS_PER_MINUTE = { requests: 120, writes: 30, failedAuth: 30 } as const;
/** A JSON-RPC batch (protocol 2025-03-26 only; later versions removed batching) holds at most this many messages. */
const MCP_MAX_BATCH = 10;
/** The answer to one POST is at most this many bytes of JSON. */
export const MCP_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** The only protocol version with JSON-RPC batches; it is also assumed without the header. */
const BATCH_VERSION = '2025-03-26';

const INSTRUCTIONS = [
  'Help by eGrant (code name Spolu) is the eGrant team’s workspace with its clients: groups (one per client, plus the internal admin group), chats, task boards, support tickets, knowledge (notes, files, meetings), projects with events, bulk email, and finance documents.',
  'You act as the user who made the token, with exactly their permissions: what they may not see answers 404, what they may not change 403.',
  'Start with whoami and list_groups; every other tool takes the ids they return. Lists are paged: pass the answer’s nextCursor (or the named cursor) back.',
  'Writes appear in the app at once and notify people as if the user did them. There are no delete tools.',
  'Finance tools (documents, contracts, work log, time, rates, overviews, rankings) are there only when the user holds the finance right; amounts are integer cents (amountMinor, rateMinor).',
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

/** The id a message would be answered with, or undefined for one that gets no answer. */
function answerId(message: unknown): JsonRpcId | null | undefined {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return null;
  const { id } = message as JsonRpcMessage;
  if (id === undefined) return undefined; // a notification
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

/**
 * Handles the messages of one POST in order and collects the answers while their JSON stays
 * under `maxBytes`. The message whose answer crosses the limit has run (a write is done), so it
 * answers that its answer was dropped; the ones after it are not run.
 */
export async function collectAnswers(
  messages: readonly unknown[],
  handle: (message: unknown) => Promise<JsonRpcResponse | null>,
  maxBytes: number = MCP_MAX_RESPONSE_BYTES,
): Promise<JsonRpcResponse[]> {
  const limit = `${Math.round(maxBytes / 1024 / 1024)} MB`;
  const answers: JsonRpcResponse[] = [];
  let size = 2; // the array's brackets
  let full = false;
  for (const message of messages) {
    if (full) {
      const id = answerId(message);
      if (id !== undefined) {
        answers.push(
          rpcError(
            id,
            -32603,
            `The request was not run: the answer reached its ${limit} limit; send fewer requests at once`,
          ),
        );
      }
      continue;
    }
    const answer = await handle(message);
    if (!answer) continue;
    const bytes = Buffer.byteLength(JSON.stringify(answer)) + 1;
    if (size + bytes > maxBytes) {
      full = true;
      answers.push(
        rpcError(
          answer.id,
          -32603,
          `Answer too large (over ${limit}): the request ran, but its answer was dropped; narrow the query or send fewer requests at once`,
        ),
      );
      continue;
    }
    size += bytes;
    answers.push(answer);
  }
  return answers;
}

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
    if (tool.write && !allowWrite(auth.user.id)) {
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
        {
          user: auth.user,
          scope: auth.scope,
          api: createApiCaller(root, auth.user, ip, auth.scope, {
            id: auth.tokenId,
            name: auth.tokenName,
          }),
        },
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

  // RFC 9728 §5.1: the 401 names the protected resource metadata, where an OAuth client
  // (Claude's custom connector) finds the authorization server (ADR 0034).
  const resourceMetadata = `${new URL(deps.config.publicUrl).origin}/.well-known/oauth-protected-resource/mcp`;
  const unauthorized = (reply: FastifyReply, invalidToken: boolean) =>
    reply
      .code(401)
      .header(
        'www-authenticate',
        `Bearer realm="spolu", resource_metadata="${resourceMetadata}"${invalidToken ? ', error="invalid_token"' : ''}`,
      )
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

    // An address over the failed sign-in limit waits out the window, before any token lookup.
    if (allowFailure.exceeded(request.ip)) return reply.code(429).send({ error: 'rate_limited' });
    const header = request.headers.authorization ?? '';
    const raw = /^Bearer (\S+)$/i.exec(header)?.[1];
    const auth = raw ? await authenticateToken(db, raw) : null;
    if (!auth) {
      if (!allowFailure(request.ip)) return reply.code(429).send({ error: 'rate_limited' });
      return unauthorized(reply, raw !== undefined);
    }
    if (!canUseMcp(auth.user)) return reply.code(403).send({ error: 'forbidden' });
    // Per user: all of a user's tokens share one budget.
    if (!allowRequest(auth.user.id)) return reply.code(429).send({ error: 'rate_limited' });

    const body = request.body;
    if (body === PARSE_ERROR || body === undefined) {
      return reply.code(400).send(rpcError(null, -32700, 'Parse error'));
    }
    const handleOne = (message: unknown) => handle(message, auth, request.ip, request.log);
    if (Array.isArray(body)) {
      // 2025-06-18 and later removed batching; 2025-03-26 (also assumed without the header) has it.
      if (version !== undefined && String(version) !== BATCH_VERSION) {
        return reply
          .code(400)
          .send(
            rpcError(null, -32600, `Invalid Request: no JSON-RPC batch in protocol ${version}`),
          );
      }
      if (body.length === 0) return reply.code(400).send(rpcError(null, -32600, 'Invalid Request'));
      if (body.length > MCP_MAX_BATCH) {
        return reply
          .code(400)
          .send(
            rpcError(
              null,
              -32600,
              `Invalid Request: a batch holds at most ${MCP_MAX_BATCH} messages`,
            ),
          );
      }
      // Every message counts against the limit (the first was counted above).
      for (let i = 1; i < body.length; i += 1) {
        if (!allowRequest(auth.user.id)) return reply.code(429).send({ error: 'rate_limited' });
      }
      const answers = await collectAnswers(body, handleOne);
      return answers.length === 0 ? reply.code(202).send() : reply.send(answers);
    }
    const [answer] = await collectAnswers([body], handleOne);
    return answer ? reply.send(answer) : reply.code(202).send();
  });

  // No server-to-client stream and no sessions (stateless).
  const notAllowed = async (_request: unknown, reply: FastifyReply) =>
    reply.code(405).header('allow', 'POST').send({ error: 'method_not_allowed' });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
};
