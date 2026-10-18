import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  EgrantManagerBodySchema,
  ErrorCodes,
  intakeFieldNames,
  type EgrantManagerResponse,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { egrantWebhookKey } from '../../infra/config/config.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { bearerKeyMatches } from '../../infra/http/bearer-key.js';
import { egrantSignature } from '../../infra/http/egrant-signature.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { joinGroupRoom, leaveGroupRoom } from '../../infra/realtime/rooms.js';
import { memberAddedEmail, memberInvitedEmail } from '../auth/emails.js';
import { addEgrantClient, removeEgrantClient } from './egrant-clients.js';
import { egrantInstanceUrl } from './egrant-url.js';
import { inviteLoginUrl } from './invite-token.js';
import { findGroupByEgrantUrl } from './service.js';

/** The webhook's body is four short fields; 16 KiB is far more than enough. */
const BODY_LIMIT = 16 * 1024;
/** Calls a minute from one IP address. */
const PER_MINUTE = 60;
/** Who "invited" or "added" the person in the reused invite emails. */
const ACTOR = 'eGrant';

const send = (reply: FastifyReply, status: number, error: string) =>
  reply.code(status).send({ error });

const refusals = {
  email_is_admin: ErrorCodes.emailIsAdmin,
  user_disabled: ErrorCodes.userDisabled,
} as const;

/**
 * The eGrant managers webhook: eGrant adds or removes a manager of an organisation, who is the
 * client's own person, so Help adds or removes a client member of that instance's client group
 * (`docs/integrations/egrant-managers.md`). EGRANT_MANAGERS_API_KEY (or, unset, the
 * ticket intake's shared key) is the credential; there is no session. It never touches admins or `group_managers`.
 */
export const egrantManagersRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps },
) => {
  const { config, db, jobs } = deps;
  const allow = createRateLimiter({ windowMs: 60_000, max: PER_MINUTE });

  // Checked before the body is read. The limit counts every call, so a wrong key is limited too.
  // EGRANT_MANAGERS_API_KEY, or the ticket intake's TICKETS_API_KEY when it is unset.
  const key = egrantWebhookKey(config, 'managers');
  const gate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!key) return send(reply, 503, ErrorCodes.intakeDisabled);
    if (!allow(request.ip)) return send(reply, 429, ErrorCodes.rateLimited);
    if (!bearerKeyMatches(request.headers.authorization, key)) {
      return send(reply, 401, ErrorCodes.unauthorized);
    }
  };

  app.put(
    '/egrant/managers',
    // Optional HMAC signature (EGRANT_MANAGERS_SIGNING_SECRET, ADR 0042), after the key.
    { onRequest: gate, bodyLimit: BODY_LIMIT, ...egrantSignature(config, 'managers') },
    async (request, reply) => {
      const body = EgrantManagerBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: ErrorCodes.validationFailed,
          fields: intakeFieldNames(body.error.issues),
        });
      }
      const { instance_url, email, active, name } = body.data;
      const group = await findGroupByEgrantUrl(db, egrantInstanceUrl(instance_url));
      if (!group) {
        request.log.info({ active }, 'egrant manager webhook: unknown instance');
        return send(reply, 404, ErrorCodes.unknownInstance);
      }
      // A deactivated client's people stay as they are until it is reactivated.
      if (group.deactivatedAt) {
        request.log.info({ groupId: group.id, active }, 'egrant manager webhook: deactivated');
        return send(reply, 409, ErrorCodes.groupInactive);
      }

      const change = active
        ? await addEgrantClient(db, group.id, { email, name: name ?? null })
        : await removeEgrantClient(db, group.id, email);
      if (change.refused) {
        // No email in the log.
        request.log.warn(
          { groupId: group.id, active, reason: change.refused },
          'egrant manager webhook: refused',
        );
        return send(reply, 422, refusals[change.refused]);
      }
      const { state, account } = change;
      request.log.info(
        { groupId: group.id, userId: account?.id ?? null, state },
        'egrant manager webhook: done',
      );

      if (account && state === 'removed') leaveGroupRoom(app.io, account.id, group.id);
      if (account && (state === 'added' || state === 'created')) {
        joinGroupRoom(app.io, account.id, group.id);
        // The membership is committed; a failed email must not turn this into an error.
        try {
          const to = { to: account.email, lang: account.language, publicUrl: config.publicUrl };
          await sendEmailLater(
            jobs,
            account.emailVerified
              ? memberAddedEmail(to, {
                  groupName: group.name,
                  addedBy: ACTOR,
                  groupUrl: `${config.publicUrl}/groups/${group.id}`,
                })
              : memberInvitedEmail(to, {
                  groupName: group.name,
                  invitedBy: ACTOR,
                  loginUrl: inviteLoginUrl(config.publicUrl, config.appSecret, {
                    groupId: group.id,
                    invitedBy: ACTOR,
                    email: account.email,
                  }),
                }),
          );
        } catch (error) {
          request.log.error({ err: error, groupId: group.id }, 'egrant member email failed');
        }
      }
      const answer: EgrantManagerResponse = {
        state,
        group_id: group.id,
        user_id: account?.id ?? null,
      };
      return reply.code(200).send(answer);
    },
  );
};
