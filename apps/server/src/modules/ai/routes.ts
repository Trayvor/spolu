import { performance } from 'node:perf_hooks';
import type { FastifyPluginAsync } from 'fastify';
import { ErrorCodes, type AiStatus, type TaskProposals } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import { findReadableMessage } from '../chat/messages.js';
import { AiFailedError, AiTimeoutError, type SplitResult } from './provider.js';
import { AiNoTasksError, AiUnavailableError, proposeTasks } from './split.js';

type IdParams = { Params: { id: string } };
type Outcome = 'ok' | 'no_tasks' | 'failed' | 'timeout';

/**
 * AI features. The task split has no rate limit of its own (owner decision); the global API
 * limit still applies, and every call that reaches the provider is logged for cost tracking.
 */
export const aiRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const anyUser = requireUser(app.auth);

  app.get('/ai/status', { preHandler: anyUser }, async (): Promise<AiStatus> => {
    return { taskSplit: deps.ai !== null };
  });

  app.post<IdParams>(
    '/messages/:id/task-split',
    { preHandler: anyUser },
    async (request, reply) => {
      const unavailable = () => reply.code(503).send({ error: ErrorCodes.aiUnavailable });
      if (deps.ai === null) return unavailable();
      const actor = request.user!;
      const found = await findReadableMessage(deps.db, actor, request.params.id);
      if (!found || found.message.deletedAt !== null) {
        return reply.code(404).send({ error: ErrorCodes.notFound });
      }
      if (found.message.body.trim() === '') {
        return reply.code(400).send({ error: ErrorCodes.validationFailed });
      }

      const started = performance.now();
      const log = (outcome: Outcome, usage: SplitResult['usage'], durationMs?: number) =>
        request.log.info(
          {
            ai: {
              userId: actor.id,
              messageId: found.message.id,
              durationMs: durationMs ?? Math.round(performance.now() - started),
              outcome,
              usage,
            },
          },
          'ai task split',
        );
      try {
        const result = await proposeTasks(deps, found);
        log('ok', result.usage, result.durationMs);
        const body: TaskProposals = { tasks: result.tasks };
        return body;
      } catch (error) {
        if (error instanceof AiUnavailableError) return unavailable();
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
    },
  );
};
