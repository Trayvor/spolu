import { performance } from 'node:perf_hooks';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  ClaudePromptRequestSchema,
  ErrorCodes,
  TaskSplitTextSchema,
  type AiStatus,
  type ClaudePrompt,
  type TaskProposals,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import { findReadableMessage } from '../chat/messages.js';
import { getGroup } from '../groups/service.js';
import { clientGroupIds } from '../groups/memberships.js';
import { canReadGroup } from '../groups/policy.js';
import { canReadTicket, canSplitTicket } from '../tickets/policy.js';
import { getTicketRow, roleIn } from '../tickets/service.js';
import { getUserById } from '../users/service.js';
import { taskClaudePrompt, ticketClaudePrompt } from './claude-context.js';
import { canOpenInClaude } from './policy.js';
import { AiFailedError, AiTimeoutError, type SplitResult } from './provider.js';
import {
  AiNoTasksError,
  AiUnavailableError,
  proposeTasks,
  proposeTextTasks,
  proposeTicketTasks,
  type Proposed,
} from './split.js';

type IdParams = { Params: { id: string } };
type Outcome = 'ok' | 'no_tasks' | 'failed' | 'timeout';

/**
 * AI features. The task split has no rate limit of its own (owner decision); the global API
 * limit still applies, and every call that reaches the provider is logged for cost tracking.
 */
export const aiRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const anyUser = requireUser(app.auth);
  const unavailable = (reply: FastifyReply) =>
    reply.code(503).send({ error: ErrorCodes.aiUnavailable });

  /** Runs one split, logs it with its source (message or ticket id) and maps its errors. */
  async function runSplit(
    request: FastifyRequest,
    reply: FastifyReply,
    source: { messageId: string } | { ticketId: string } | { groupId: string },
    propose: () => Promise<Proposed>,
  ) {
    const started = performance.now();
    const log = (outcome: Outcome, usage: SplitResult['usage'], durationMs?: number) =>
      request.log.info(
        {
          ai: {
            userId: request.user!.id,
            ...source,
            durationMs: durationMs ?? Math.round(performance.now() - started),
            outcome,
            usage,
          },
        },
        'ai task split',
      );
    try {
      const result = await propose();
      log('ok', result.usage, result.durationMs);
      const body: TaskProposals = { tasks: result.tasks, files: result.files ?? [] };
      return body;
    } catch (error) {
      if (error instanceof AiUnavailableError) return unavailable(reply);
      if (error instanceof AiNoTasksError) {
        log('no_tasks', error.usage);
        return reply.code(422).send({ error: ErrorCodes.aiNoTasks });
      }
      if (error instanceof AiFailedError) {
        log(error instanceof AiTimeoutError ? 'timeout' : 'failed', null);
        request.log.warn({ reason: error.message }, 'ai task split failed');
        return reply.code(502).send({ error: ErrorCodes.aiFailed });
      }
      throw error;
    }
  }

  // "Vyriešiť s Claude" (Phase 29): builds the prompt text only; nothing runs AI and nothing is
  // written. POST for the admin's notes. Admins only, checked before the lookup so others cannot
  // probe ids. Answers null after sending the error.
  async function promptOptions(request: FastifyRequest, reply: FastifyReply) {
    if (!canOpenInClaude(request.user!)) {
      await reply.code(403).send({ error: ErrorCodes.forbidden });
      return null;
    }
    const parsed = ClaudePromptRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await reply.code(400).send({ error: ErrorCodes.validationFailed });
      return null;
    }
    return {
      publicUrl: deps.config.publicUrl,
      language: (await getUserById(deps.db, request.user!.id))?.language ?? 'sk',
      notes: parsed.data.notes,
      // The authenticated actor, never the request body.
      generatedBy: {
        name: request.user!.name,
        email: request.user!.email,
        role: request.user!.role,
      },
      generatedAt: new Date(),
    };
  }
  app.post<IdParams>(
    '/tickets/:id/claude-prompt',
    { preHandler: anyUser },
    async (request, reply) => {
      const options = await promptOptions(request, reply);
      if (options === null) return reply;
      const ticket = await getTicketRow(deps.db, request.params.id);
      if (!ticket) return reply.code(404).send({ error: ErrorCodes.notFound });
      const body: ClaudePrompt = await ticketClaudePrompt(deps.db, ticket, options);
      return body;
    },
  );
  app.post<IdParams>(
    '/tasks/:id/claude-prompt',
    { preHandler: anyUser },
    async (request, reply) => {
      const options = await promptOptions(request, reply);
      if (options === null) return reply;
      const body: ClaudePrompt | null = await taskClaudePrompt(deps.db, request.params.id, options);
      if (body === null) return reply.code(404).send({ error: ErrorCodes.notFound });
      return body;
    },
  );

  app.get('/ai/status', { preHandler: anyUser }, async (): Promise<AiStatus> => {
    return {
      taskSplit: deps.ai !== null,
      meetingSummary: deps.meetingSummary !== null,
      transcription: deps.transcription !== null,
      ticketDraft: deps.ticketDraft !== null,
    };
  });

  app.post<IdParams>(
    '/messages/:id/task-split',
    { preHandler: anyUser },
    async (request, reply) => {
      if (deps.ai === null) return unavailable(reply);
      const actor = request.user!;
      const found = await findReadableMessage(deps.db, actor, request.params.id);
      if (!found || found.message.deletedAt !== null) {
        return reply.code(404).send({ error: ErrorCodes.notFound });
      }
      // The cards go on the group's board: someone who reads the chat but not the group (a
      // ziadatel in a ticket chat) may not turn its messages into tasks.
      const groupIds = await clientGroupIds(deps.db, actor.id);
      if (!canReadGroup(actor, found.channel.groupId, groupIds)) {
        return reply.code(403).send({ error: ErrorCodes.forbidden });
      }
      if (found.message.body.trim() === '') {
        return reply.code(400).send({ error: ErrorCodes.validationFailed });
      }
      return runSplit(request, reply, { messageId: found.message.id }, () =>
        proposeTasks(deps, found),
      );
    },
  );

  // A text pasted on a board (owner request 2026-10-21): whoever reads the group may create tasks
  // on its board. A missing group and one the actor may not read both answer 404.
  app.post<IdParams>(
    '/groups/:id/task-split-text',
    { preHandler: anyUser },
    async (request, reply) => {
      if (deps.ai === null) return unavailable(reply);
      const actor = request.user!;
      const groupId = request.params.id;
      const groupIds = await clientGroupIds(deps.db, actor.id);
      if (!canReadGroup(actor, groupId, groupIds) || !(await getGroup(deps.db, groupId))) {
        return reply.code(404).send({ error: ErrorCodes.notFound });
      }
      const body = TaskSplitTextSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
      return runSplit(request, reply, { groupId }, () =>
        proposeTextTasks(deps, groupId, body.data.text),
      );
    },
  );

  // A ticket (part 21.5): admins and the ticket group's clients; a ziadatel 403; no client 409.
  app.post<IdParams>('/tickets/:id/task-split', { preHandler: anyUser }, async (request, reply) => {
    if (deps.ai === null) return unavailable(reply);
    const actor = request.user!;
    const ticket = await getTicketRow(deps.db, request.params.id);
    const role = ticket ? await roleIn(deps.db, actor, ticket.groupId) : null;
    if (!ticket || !canReadTicket(actor, ticket, role)) {
      return reply.code(404).send({ error: ErrorCodes.notFound });
    }
    if (ticket.groupId === null) return reply.code(409).send({ error: ErrorCodes.noClient });
    if (!canSplitTicket(actor, ticket, role)) {
      return reply.code(403).send({ error: ErrorCodes.forbidden });
    }
    return runSplit(request, reply, { ticketId: ticket.id }, () =>
      proposeTicketTasks(deps, ticket),
    );
  });
};
