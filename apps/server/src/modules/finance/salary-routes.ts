import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import {
  ErrorCodes,
  LinkDocumentBodySchema,
  SalariesQuerySchema,
  SalaryBodySchema,
  SalaryPatchSchema,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { getSessionUser } from '../auth/session.js';
import { auditActorOf } from '../audit/request-actor.js';
import { InvalidAttachmentError } from '../files/service.js';
import { FinanceChangedError, FinanceNotFoundError, FinanceValidationError } from './errors.js';
import { emitFinanceChanged } from './events.js';
import { canSeeSalaries } from './policy.js';
import {
  createSalary,
  deleteSalary,
  getSalary,
  InvalidDocumentLinkError,
  InvalidSalaryCursorError,
  linkDocument,
  listSalaries,
  unlinkDocument,
  updateSalary,
  type CostTarget,
} from './salaries.js';

type IdParams = { Params: { id: string } };
type LinkParams = { Params: { id: string; documentId: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const notFound = (reply: FastifyReply) => send(reply, 404, ErrorCodes.notFound);
const invalid = (reply: FastifyReply) => send(reply, 400, ErrorCodes.validationFailed);

function salaryError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof FinanceNotFoundError) return notFound(reply);
  if (error instanceof FinanceChangedError) return send(reply, 409, ErrorCodes.financeChanged);
  if (error instanceof InvalidAttachmentError) {
    return send(reply, 400, ErrorCodes.invalidAttachment);
  }
  if (
    error instanceof FinanceValidationError ||
    error instanceof InvalidSalaryCursorError ||
    error instanceof InvalidDocumentLinkError
  ) {
    return invalid(reply);
  }
  throw error;
}

/**
 * Salaries and document links (owner request of 2026-10-21, ADR 0065). Outside the finance
 * plugin's `requireFinance` on purpose: anyone without the finance right gets **404** here (an
 * admin without it does not learn that salaries exist, not even their own), a request without a
 * session 401. Every write tells the finance room (`finance:changed`, kind `items`, no client:
 * every open finance screen refetches). Files are uploaded with `POST /api/finance/org/files`.
 *   GET    /api/finance/salaries?admin=&from=&to=&after=
 *   POST   /api/finance/salaries
 *   GET    /api/finance/salaries/:id
 *   PATCH  /api/finance/salaries/:id
 *   DELETE /api/finance/salaries/:id
 *   POST   /api/finance/salaries/:id/documents          { documentId }
 *   DELETE /api/finance/salaries/:id/documents/:documentId
 *   POST   /api/finance/expenses/:id/documents          { documentId }
 *   DELETE /api/finance/expenses/:id/documents/:documentId
 */
export const financeSalaryRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const allowWrite = createRateLimiter({ windowMs: 60_000, max: 120 });
  const guard: preHandlerAsyncHookHandler = async (request, reply) => {
    const user = await getSessionUser(app.auth, request);
    if (!user) return send(reply, 401, ErrorCodes.unauthorized);
    if (!canSeeSalaries(user)) return notFound(reply);
    request.user = user;
  };
  const limitWrites: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!allowWrite(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
  };
  const changed = () => emitFinanceChanged(app.io, null, 'items');

  app.addHook('preHandler', guard);

  app.get('/finance/salaries', async (request, reply) => {
    const query = SalariesQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    const { admin, from, to, after } = query.data;
    try {
      return await listSalaries(db, {
        ...(admin ? { admin } : {}),
        ...(from && to ? { range: { from, to } } : {}),
        ...(after ? { after } : {}),
      });
    } catch (error) {
      return salaryError(reply, error);
    }
  });

  app.post('/finance/salaries', { preHandler: limitWrites }, async (request, reply) => {
    const body = SalaryBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    try {
      const salary = await createSalary(db, request.user!.id, body.data, auditActorOf(request));
      changed();
      return reply.code(201).send(salary);
    } catch (error) {
      return salaryError(reply, error);
    }
  });

  app.get<IdParams>('/finance/salaries/:id', async (request, reply) => {
    try {
      return await getSalary(db, request.params.id);
    } catch (error) {
      return salaryError(reply, error);
    }
  });

  app.patch<IdParams>(
    '/finance/salaries/:id',
    { preHandler: limitWrites },
    async (request, reply) => {
      const patch = SalaryPatchSchema.safeParse(request.body);
      if (!patch.success) return invalid(reply);
      try {
        const salary = await updateSalary(
          deps,
          request.user!.id,
          request.params.id,
          patch.data,
          auditActorOf(request),
        );
        changed();
        return salary;
      } catch (error) {
        return salaryError(reply, error);
      }
    },
  );

  app.delete<IdParams>(
    '/finance/salaries/:id',
    { preHandler: limitWrites },
    async (request, reply) => {
      try {
        await deleteSalary(deps, request.params.id, auditActorOf(request));
        changed();
        return reply.code(204).send();
      } catch (error) {
        return salaryError(reply, error);
      }
    },
  );

  for (const kind of ['salary', 'expense'] as const) {
    const base = kind === 'salary' ? '/finance/salaries' : '/finance/expenses';
    const targetOf = (id: string): CostTarget => ({ kind, id });

    app.post<IdParams>(
      `${base}/:id/documents`,
      { preHandler: limitWrites },
      async (request, reply) => {
        const body = LinkDocumentBodySchema.safeParse(request.body);
        if (!body.success) return invalid(reply);
        try {
          const made = await linkDocument(
            db,
            targetOf(request.params.id),
            body.data.documentId,
            auditActorOf(request),
          );
          if (made) changed();
          return reply.code(made ? 201 : 200).send({ linked: true });
        } catch (error) {
          return salaryError(reply, error);
        }
      },
    );

    app.delete<LinkParams>(
      `${base}/:id/documents/:documentId`,
      { preHandler: limitWrites },
      async (request, reply) => {
        try {
          await unlinkDocument(
            db,
            targetOf(request.params.id),
            request.params.documentId,
            auditActorOf(request),
          );
          changed();
          return reply.code(204).send();
        } catch (error) {
          return salaryError(reply, error);
        }
      },
    );
  }
};
