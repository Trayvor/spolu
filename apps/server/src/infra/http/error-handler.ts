import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyInstance } from 'fastify';

/**
 * The root error handler for errors a route did not answer itself (a thrown error, a failed
 * query, a Fastify error such as a malformed body).
 *
 * - 5xx: the client gets only `{ error: 'internal_error' }`. Fastify's default answer carries
 *   `error.message`, and a drizzle query error's message is the full SQL with its parameters,
 *   which may hold other users' data. The whole error goes to the server log instead.
 * - 4xx (Fastify's own: invalid JSON, payload too large, unsupported media type...): unchanged,
 *   Fastify's `{ statusCode, code, error, message }`; those messages hold no internals.
 *
 * Routes keep answering their own codes (`{ error: 'validation_failed' }` and so on) through
 * `reply.code().send()`, which never reaches this handler.
 *
 * `known` turns an error every route may throw into its answer first (for example a write into a
 * deactivated group, refused by a database trigger, is `409 group_inactive`); null passes it on.
 */
export type KnownError = (error: unknown) => { status: number; body: object } | null;

export function registerErrorHandler(app: FastifyInstance, known?: KnownError): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const answer = known?.(error);
    if (answer) return reply.code(answer.status).send(answer.body);
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      request.log.info({ err: error }, 'client error');
      return reply.code(status).send({
        statusCode: status,
        code: error.code,
        error: STATUS_CODES[status] ?? 'Client Error',
        message: error.message,
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error' });
  });
}
