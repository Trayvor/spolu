import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  base64DecodedSize,
  EGRANT_GROUP_LIMITS,
  EgrantGroupBodySchema,
  ErrorCodes,
  intakeFieldNames,
  type EgrantGroupBody,
  type EgrantGroupResponse,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { egrantWebhookKey } from '../../infra/config/config.js';
import { bearerKeyMatches } from '../../infra/http/bearer-key.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { StorageNotFoundError } from '../../infra/storage/storage.js';
import { IMAGE_TYPES, sniffImageType, type ImageType } from '../files/sniff.js';
import { setGroupActive } from './deactivation.js';
import { egrantInstanceUrl, normalizeEgrantUrl } from './egrant-url.js';
import { removeGroupLogo, replaceGroupLogo } from './logo.js';
import { stripImageMetadata } from './logo-metadata.js';
import {
  createGroup,
  EgrantUrlTakenError,
  findGroupsByEgrantUrl,
  updateGroup,
  type GroupRow,
} from './service.js';

/** Calls a minute from one IP address. */
const PER_MINUTE = 60;
const LOGO_FIELD = 'logo.data_base64';

type Logo = { bytes: Buffer; type: ImageType };
type Answer = { status: number; body: object };

const fail = (status: number, error: string, fields?: string[]): Answer => ({
  status,
  body: fields ? { error, fields } : { error },
});

/**
 * Checks and cleans the sent logo: the declared type must be PNG, JPEG or WebP (415; SVG never,
 * it can carry scripts), at most 2 MiB (413), and the bytes must be that image (422). The
 * metadata is stripped. Undefined keeps the logo, null removes it.
 */
function readLogo(logo: EgrantGroupBody['logo']): Logo | null | undefined | Answer {
  if (logo === undefined || logo === null) return logo;
  const declared = logo.content_type.split(';')[0]!.trim();
  if (!(IMAGE_TYPES as readonly string[]).includes(declared)) {
    return fail(415, ErrorCodes.unsupportedType, ['logo.content_type']);
  }
  if (base64DecodedSize(logo.data_base64) > EGRANT_GROUP_LIMITS.logoBytes) {
    return fail(413, ErrorCodes.fileTooLarge, [LOGO_FIELD]);
  }
  const raw = Buffer.from(logo.data_base64, 'base64');
  const type = sniffImageType(raw);
  const bytes = type === declared ? stripImageMetadata(raw, type) : null;
  if (!type || !bytes) return fail(422, ErrorCodes.invalidLogo, [LOGO_FIELD]);
  return { bytes, type };
}

const isAnswer = (value: unknown): value is Answer =>
  typeof value === 'object' && value !== null && 'status' in value;

/**
 * The eGrant groups webhook (`docs/integrations/egrant.md`, "Groups"): eGrant creates or
 * updates the client group of one of its instances, with the name and the logo, and deactivates
 * or reactivates it (`active`). Idempotent, keyed by the instance's host. It never deletes a
 * group and never touches members or managers
 * (the managers webhook adds members). The credential is `EGRANT_GROUPS_API_KEY`, else the
 * ticket intake's key (`egrantWebhookKey`); there is no session.
 */
export const egrantGroupsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { config, db, storage } = deps;
  const allow = createRateLimiter({ windowMs: 60_000, max: PER_MINUTE });
  const key = egrantWebhookKey(config, 'groups');

  // Checked before the body is read. The limit counts every call, so a wrong key is limited too.
  const gate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!key) return reply.code(503).send({ error: ErrorCodes.intakeDisabled });
    if (!allow(request.ip)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
    if (!bearerKeyMatches(request.headers.authorization, key)) {
      return reply.code(401).send({ error: ErrorCodes.unauthorized });
    }
  };

  /** True when the group's stored logo is these bytes (a resend changes nothing). */
  const sameLogo = async (group: GroupRow, logo: Logo): Promise<boolean> => {
    if (!group.logoKey) return false;
    try {
      const file = await storage.get(group.logoKey);
      if (file.size !== logo.bytes.length || file.contentType !== logo.type) {
        file.stream.destroy();
        return false;
      }
      const parts: Buffer[] = [];
      for await (const part of file.stream) parts.push(part as Buffer);
      return Buffer.concat(parts).equals(logo.bytes);
    } catch (error) {
      if (error instanceof StorageNotFoundError) return false;
      throw error;
    }
  };

  /** Applies the name and the logo to an existing group; true when anything changed. */
  const update = async (group: GroupRow, name: string, logo: Logo | null | undefined) => {
    let changed = false;
    if (group.name !== name) {
      await updateGroup(db, group.id, { name, egrantUrl: group.egrantUrl! });
      changed = true;
    }
    if (logo === null && group.logoKey) {
      await removeGroupLogo({ db, storage }, group.id);
      changed = true;
    } else if (logo && !(await sameLogo(group, logo))) {
      await replaceGroupLogo({ db, storage }, group.id, logo.bytes, logo.type);
      changed = true;
    }
    return changed;
  };

  const handle = async (body: EgrantGroupBody): Promise<Answer> => {
    const url = normalizeEgrantUrl(egrantInstanceUrl(body.instance_url));
    if (!url) return fail(400, ErrorCodes.validationFailed, ['instance_url']);
    const logo = readLogo(body.logo);
    if (isAnswer(logo)) return logo;

    const found = await findGroupsByEgrantUrl(db, url, 2);
    if (found.length > 1) return fail(409, ErrorCodes.ambiguousInstance);
    let group = found[0];
    // Deactivating an instance Help does not know: nothing to do, and nothing is created.
    if (!group && body.active === false) return fail(404, ErrorCodes.unknownInstance);
    if (!group) {
      try {
        // The in-app create: the same defaults (a client group with a fresh invite link).
        const created = await createGroup(db, { name: body.name, egrantUrl: url });
        if (logo) await replaceGroupLogo({ db, storage }, created.id, logo.bytes, logo.type);
        const answer: EgrantGroupResponse = { state: 'created', group_id: created.id };
        return { status: 201, body: answer };
      } catch (error) {
        if (!(error instanceof EgrantUrlTakenError)) throw error;
        // A parallel call created it a moment ago: update that one.
        group = (await findGroupsByEgrantUrl(db, url, 1))[0];
        if (!group) return fail(409, ErrorCodes.egrantUrlTaken);
      }
    }
    const changed = await update(group, body.name, logo);
    // The same `setGroupActive` as the app's Deactivate / Reactivate; omitted keeps the state.
    const status =
      body.active === undefined
        ? null
        : await setGroupActive({ db, io: app.io }, group.id, body.active);
    const state: EgrantGroupResponse['state'] = status?.changed
      ? body.active
        ? 'reactivated'
        : 'deactivated'
      : changed
        ? 'updated'
        : 'unchanged';
    const answer: EgrantGroupResponse = { state, group_id: group.id };
    return { status: 200, body: answer };
  };

  app.put(
    '/egrant/groups',
    { onRequest: gate, bodyLimit: EGRANT_GROUP_LIMITS.bodyBytes },
    async (request, reply) => {
      const parsed = EgrantGroupBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: ErrorCodes.validationFailed,
          fields: intakeFieldNames(parsed.error.issues),
        });
      }
      const answer = await handle(parsed.data);
      // No key, name or image data in the log.
      const state = (answer.body as { state?: string }).state;
      const groupId = (answer.body as { group_id?: string }).group_id;
      const logo = parsed.data.logo === undefined ? 'kept' : parsed.data.logo ? 'sent' : 'removed';
      if (answer.status < 300) {
        request.log.info({ groupId, state, logo }, 'egrant group webhook: done');
      } else {
        const error = (answer.body as { error: string }).error;
        request.log.warn({ status: answer.status, error, logo }, 'egrant group webhook: refused');
      }
      return reply.code(answer.status).send(answer.body);
    },
  );
};
