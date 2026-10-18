import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  EgrantManagerBodySchema,
  ErrorCodes,
  intakeFieldNames,
  type EgrantManagerResponse,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { bearerKeyMatches } from '../../infra/http/bearer-key.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { findUserByEmail, type UserRow } from '../users/service.js';
import { managerAddedEmail } from './emails.js';
import { emitManagers } from './events.js';
import { addManager, NotAnAdminError, removeManager } from './managers.js';
import { findGroupByEgrantUrl } from './service.js';

/** The webhook's body is three short fields; 16 KiB is far more than enough. */
const BODY_LIMIT = 16 * 1024;
/** Calls a minute from one IP address. */
const PER_MINUTE = 60;

const send = (reply: FastifyReply, status: number, error: string) =>
  reply.code(status).send({ error });

/** A bare host (`mesto-x.egrant.sk`) is read as `https://<host>`, so it matches like a URL. */
const asUrl = (instance: string): string =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(instance) ? instance : `https://${instance}`;

/**
 * May eGrant make this account a manager? Only an existing active admin or the superadmin: the
 * webhook never creates accounts or grants a role. Removing also takes a disabled admin (their
 * row would count again if they were re-enabled); never a client.
 */
function canTarget(account: UserRow | null, active: boolean): account is UserRow {
  if (!account || account.role === 'client') return false;
  return !active || account.disabledAt === null;
}

/**
 * The eGrant managers webhook: eGrant adds or removes a manager of the client of one of its
 * instances (`docs/integrations/egrant-managers.md`). The shared key of the ticket intake is the
 * credential; there is no session.
 */
export const egrantManagersRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps },
) => {
  const { config, db, jobs } = deps;
  const allow = createRateLimiter({ windowMs: 60_000, max: PER_MINUTE });

  // Checked before the body is read. The limit counts every call, so a wrong key is limited too.
  const gate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.ticketsApiKey) return send(reply, 503, ErrorCodes.intakeDisabled);
    if (!allow(request.ip)) return send(reply, 429, ErrorCodes.rateLimited);
    if (!bearerKeyMatches(request.headers.authorization, config.ticketsApiKey)) {
      return send(reply, 401, ErrorCodes.unauthorized);
    }
  };

  app.put(
    '/egrant/managers',
    { onRequest: gate, bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const body = EgrantManagerBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: ErrorCodes.validationFailed,
          fields: intakeFieldNames(body.error.issues),
        });
      }
      const { instance_url, email, active } = body.data;
      const group = await findGroupByEgrantUrl(db, asUrl(instance_url));
      if (!group) {
        request.log.info({ active }, 'egrant manager webhook: unknown instance');
        return send(reply, 404, ErrorCodes.unknownInstance);
      }
      const account = await findUserByEmail(db, email);
      if (!canTarget(account, active)) {
        // No email in the log: whoever it is, they have no admin account here.
        request.log.warn({ groupId: group.id, active }, 'egrant manager webhook: unknown admin');
        return send(reply, 422, ErrorCodes.unknownAdmin);
      }

      let result: Awaited<ReturnType<typeof addManager>>;
      try {
        result = await (active ? addManager : removeManager)(db, group.id, account.id);
      } catch (error) {
        // Disabled or demoted between the lookup and the change.
        if (error instanceof NotAnAdminError) return send(reply, 422, ErrorCodes.unknownAdmin);
        throw error;
      }
      const { changed, managers } = result;
      const state: EgrantManagerResponse['state'] = !changed
        ? 'unchanged'
        : active
          ? 'added'
          : 'removed';
      request.log.info(
        { groupId: group.id, userId: account.id, state },
        'egrant manager webhook: done',
      );
      if (changed) emitManagers(app.io, { groupId: group.id, managers });
      if (state === 'removed' && managers.length === 0) {
        request.log.warn(
          { groupId: group.id },
          'egrant manager webhook: the client has no manager now',
        );
      }
      if (state === 'added') {
        try {
          await sendEmailLater(
            jobs,
            managerAddedEmail(
              { to: account.email, lang: account.language, publicUrl: config.publicUrl },
              { groupName: group.name, groupUrl: `${config.publicUrl}/groups/${group.id}` },
            ),
          );
        } catch (error) {
          // The manager stays added; only the email is lost.
          request.log.error({ err: error, groupId: group.id }, 'manager added email failed');
        }
      }
      const answer: EgrantManagerResponse = { state, group_id: group.id, user_id: account.id };
      return reply.code(200).send(answer);
    },
  );
};
