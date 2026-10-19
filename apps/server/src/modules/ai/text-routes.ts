import { performance } from 'node:perf_hooks';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  AiTextBodySchema,
  ErrorCodes,
  ID_RE,
  VOICE_LIMITS,
  type AiTextResult,
  type AiToolsInfo,
  type IncomingTranslation,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter, createSlidingRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { actorReadsChannel } from '../chat/access.js';
import { getChannel, type ChannelRow } from '../chat/service.js';
import { isAdminGroup } from '../groups/admin-group.js';
import { clientGroupIds } from '../groups/memberships.js';
import { canReadGroup } from '../groups/policy.js';
import { clientLanguages, getGroup } from '../groups/service.js';
import { isAdmin } from '../users/policy.js';
import { getUserById } from '../users/service.js';
import { clientLanguageOf, isSlovakInstance, languageName } from './client-language.js';
import { adminTextToolRoutes } from './admin-text-routes.js';
import { groupTextToolRoutes } from './group-text-routes.js';
import { AiFailedError, AiTimeoutError } from './provider.js';
import { TEXT_TOOLS_TIMEOUT_MS, withTimeout, type TextToolRequest } from './text-tools.js';
import {
  sourceHash,
  storedTranslation,
  storeTranslation,
  type TranslationSubject,
} from './translations.js';
import { translateRoutes } from './translate-routes.js';

type IdParams = { Params: { id: string } };

/** A received text to translate for its reader; the route has checked that they read it. */
export type IncomingSource = {
  subject: TranslationSubject;
  groupId: string;
  text: string;
  /** Who wrote it: they get 403 (their own text is never offered). */
  authorId: string | null;
  logFields: Record<string, unknown>;
};
type Outcome = 'ok' | 'failed' | 'timeout';

/** Per user: a burst limit and a daily cap (owner decision, Phase 28 design). */
const TEXT_TOOL_LIMITS = { perMinute: 20, perDay: 300 } as const;
const VOICE_RATE_LIMITS = { perMinute: 10, perHour: 60 } as const;
const VOICE_TIMEOUT_MS = 60_000;

const EXTENSIONS: Record<(typeof VOICE_LIMITS.types)[number], string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/**
 * What the chat's routes and the group routes of descriptions (Phase 33 part P5) share: the
 * providers, the prompts and one set of per-user limits, so a user's calls count once wherever
 * they come from. Each route checks its own access first and passes the group.
 */
export type TextToolCore = {
  /** Whether the actor reads the group (admins and its clients, never a ziadatel). */
  readsGroup(actor: SessionUser, groupId: string): Promise<boolean>;
  /** The tools' answer; `text` only when the actor reads the group. */
  info(groupId: string, readsGroup: boolean): Promise<AiToolsInfo>;
  rewrite(
    request: FastifyRequest,
    reply: FastifyReply,
    groupId: string,
    logFields: Record<string, unknown>,
  ): Promise<unknown>;
  transcribe(
    request: FastifyRequest,
    reply: FastifyReply,
    logFields: Record<string, unknown>,
  ): Promise<unknown>;
  /** 2026-10-19: a text someone else wrote, in the reader's profile language. */
  translateIncoming(
    request: FastifyRequest,
    reply: FastifyReply,
    source: IncomingSource,
  ): Promise<unknown>;
};

const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

function createTextToolCore(deps: AppDeps): TextToolCore {
  const { db } = deps;
  const burst = deps.config.aiBurstLimits;
  const textPerMinute = createRateLimiter({
    windowMs: 60_000,
    max: burst?.textPerMinute ?? TEXT_TOOL_LIMITS.perMinute,
  });
  const textPerDay = createSlidingRateLimiter({
    windowMs: 86_400_000,
    max: TEXT_TOOL_LIMITS.perDay,
  });
  const voicePerMinute = createRateLimiter({
    windowMs: 60_000,
    max: burst?.voicePerMinute ?? VOICE_RATE_LIMITS.perMinute,
  });
  const voicePerHour = createSlidingRateLimiter({
    windowMs: 3_600_000,
    max: VOICE_RATE_LIMITS.perHour,
  });

  /**
   * Translate is offered off `.sk`; `clientLanguage` null means only English. Never in the admin
   * group (Phase 34): it has no eGrant URL, so no foreign domain.
   */
  async function translateInfo(groupId: string): Promise<AiToolsInfo['translate']> {
    const group = await getGroup(db, groupId);
    if (!group?.egrantUrl || isSlovakInstance(group.egrantUrl)) return null;
    return {
      clientLanguage: clientLanguageOf(group.egrantUrl, await clientLanguages(db, group.id)),
    };
  }

  /**
   * Reading a received message in one's own language (2026-10-19): the same instances as the
   * composer's Translate (off `.sk`, never the admin group).
   */
  async function translatesIncoming(groupId: string): Promise<boolean> {
    const group = await getGroup(db, groupId);
    return (
      group !== null &&
      !isAdminGroup(group) &&
      group.egrantUrl !== null &&
      !isSlovakInstance(group.egrantUrl)
    );
  }

  function logCall(
    request: FastifyRequest,
    msg: string,
    fields: Record<string, unknown>,
    started: number,
    outcome: Outcome,
  ) {
    request.log.info(
      {
        ai: {
          userId: request.user!.id,
          ...fields,
          durationMs: Math.round(performance.now() - started),
          outcome,
        },
      },
      msg,
    );
  }

  /** Maps a provider failure to 502 after logging it; other errors propagate. */
  function failed(
    request: FastifyRequest,
    reply: FastifyReply,
    error: unknown,
    log: (outcome: Outcome) => void,
  ) {
    if (!(error instanceof AiFailedError)) throw error;
    log(error instanceof AiTimeoutError ? 'timeout' : 'failed');
    request.log.warn({ reason: error.message }, 'ai composer tool failed');
    return fail(reply, 502, ErrorCodes.aiFailed);
  }

  return {
    async readsGroup(actor, groupId) {
      const groupIds = isAdmin(actor) ? [] : await clientGroupIds(db, actor.id);
      return canReadGroup(actor, groupId, groupIds);
    },

    async info(groupId, readsGroup) {
      const text = deps.textTools !== null && readsGroup;
      // Every reader of the channel, a ziadatel too; sent only when true.
      const incoming = deps.textTools !== null && (await translatesIncoming(groupId));
      return {
        text,
        translate: text ? await translateInfo(groupId) : null,
        voice: deps.transcription !== null,
        ...(incoming ? { translateIncoming: true as const } : {}),
      };
    },

    async translateIncoming(request, reply, source) {
      const provider = deps.textTools;
      if (provider === null) return fail(reply, 503, ErrorCodes.aiUnavailable);
      const userId = request.user!.id;
      if (source.authorId === userId) return fail(reply, 403, ErrorCodes.forbidden);
      if (!(await translatesIncoming(source.groupId))) {
        return fail(reply, 403, ErrorCodes.forbidden);
      }
      if (source.text.trim() === '') return fail(reply, 400, ErrorCodes.validationFailed);
      const target = (await getUserById(db, userId))?.language ?? 'sk';
      const hash = sourceHash(source.text);
      const started = performance.now();
      const fields = { ...source.logFields, target };

      const stored = await storedTranslation(db, source.subject, target, hash);
      if (stored) {
        logCall(request, 'ai translation', { ...fields, cached: true }, started, 'ok');
        return stored;
      }
      // Only a call to the model counts, on the composer's limits.
      if (!textPerMinute(userId) || !textPerDay(userId)) {
        return fail(reply, 429, ErrorCodes.rateLimited);
      }
      try {
        const result = await withTimeout(
          (signal) =>
            provider.translateMessage(
              { text: source.text, language: languageName(target), code: target },
              signal,
            ),
          TEXT_TOOLS_TIMEOUT_MS,
        );
        const unchanged = result.sourceLanguage === target;
        const body: IncomingTranslation = {
          text: unchanged ? source.text : result.text,
          sourceLanguage: result.sourceLanguage,
          targetLanguage: target,
          unchanged,
        };
        await storeTranslation(db, source.subject, hash, { ...body, targetLanguage: target });
        logCall(
          request,
          'ai translation',
          { ...fields, cached: false, usage: result.usage },
          started,
          'ok',
        );
        return body;
      } catch (error) {
        return failed(request, reply, error, (outcome) =>
          logCall(request, 'ai translation', fields, started, outcome),
        );
      }
    },

    async rewrite(request, reply, groupId, logFields) {
      const provider = deps.textTools;
      if (provider === null) return fail(reply, 503, ErrorCodes.aiUnavailable);
      const parsed = AiTextBodySchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, ErrorCodes.validationFailed);
      const { action, target, text } = parsed.data;

      let toolRequest: TextToolRequest;
      if (action === 'translate') {
        const translate = await translateInfo(groupId);
        const code = target === 'en' ? 'en' : translate?.clientLanguage;
        if (!translate || !code) return fail(reply, 400, ErrorCodes.validationFailed);
        toolRequest = { action, text, language: languageName(code) };
      } else {
        toolRequest = { action, text };
      }
      const userId = request.user!.id;
      // Both limits count the call: a refused minute does not use up the day.
      if (!textPerMinute(userId) || !textPerDay(userId)) {
        return fail(reply, 429, ErrorCodes.rateLimited);
      }

      const started = performance.now();
      const fields = { ...logFields, action, target: target ?? null };
      try {
        const result = await withTimeout(
          (signal) => provider.rewrite(toolRequest, signal),
          TEXT_TOOLS_TIMEOUT_MS,
        );
        logCall(request, 'ai text tool', { ...fields, usage: result.usage }, started, 'ok');
        const body: AiTextResult = { text: result.text };
        return body;
      } catch (error) {
        return failed(request, reply, error, (outcome) =>
          logCall(request, 'ai text tool', fields, started, outcome),
        );
      }
    },

    async transcribe(request, reply, logFields) {
      const provider = deps.transcription;
      if (provider === null) return fail(reply, 503, ErrorCodes.aiUnavailable);
      const mime = (request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (!(VOICE_LIMITS.types as readonly string[]).includes(mime)) {
        return fail(reply, 415, ErrorCodes.unsupportedType);
      }
      if (Number(request.headers['content-length']) > VOICE_LIMITS.maxBytes) {
        return fail(reply, 413, ErrorCodes.fileTooLarge);
      }
      const userId = request.user!.id;
      if (!voicePerMinute(userId) || !voicePerHour(userId)) {
        return fail(reply, 429, ErrorCodes.rateLimited);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request.raw) {
        size += (chunk as Buffer).length;
        if (size > VOICE_LIMITS.maxBytes) {
          request.raw.destroy();
          return fail(reply, 413, ErrorCodes.fileTooLarge);
        }
        chunks.push(chunk as Buffer);
      }
      if (size === 0) return fail(reply, 400, ErrorCodes.validationFailed);

      const started = performance.now();
      const fields = { ...logFields, bytes: size, provider: provider.name };
      try {
        const { text } = await withTimeout(
          (signal) =>
            provider.transcribe(
              {
                audio: Buffer.concat(chunks),
                fileName: `voice.${EXTENSIONS[mime as keyof typeof EXTENSIONS]}`,
                mime,
              },
              signal,
            ),
          VOICE_TIMEOUT_MS,
        );
        logCall(request, 'ai voice', fields, started, 'ok');
        const body: AiTextResult = { text: text.trim() };
        return body;
      } catch (error) {
        return failed(request, reply, error, (outcome) =>
          logCall(request, 'ai voice', fields, started, outcome),
        );
      }
    },
  };
}

/**
 * Phase 28: the chat composer's AI text tools (Fix mistakes, Make it formal, Translate) and voice
 * input. The prompts live in the server; the browser sends only the text and the action. Text
 * tools: whoever reads the channel's group (admins and its clients, not a ziadatel). Voice: whoever
 * reads the channel. Every provider call is logged without the text. Phase 33 part P5 adds the
 * group routes of descriptions (`group-text-routes.ts`) on the same core and limits.
 */
export const textToolRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const anyUser = requireUser(app.auth);
  const core = createTextToolCore(deps);

  /** The channel when the actor reads it; otherwise 404 (missing and unreadable look the same). */
  async function readableChannel(
    request: FastifyRequest<IdParams>,
    reply: FastifyReply,
  ): Promise<ChannelRow | null> {
    const id = request.params.id;
    const channel = ID_RE.test(id) ? await getChannel(db, id) : null;
    if (channel && (await actorReadsChannel(db, request.user!, channel))) return channel;
    fail(reply, 404, ErrorCodes.notFound);
    return null;
  }

  app.get<IdParams>('/channels/:id/ai-tools', { preHandler: anyUser }, async (request, reply) => {
    const channel = await readableChannel(request, reply);
    if (!channel) return reply;
    return core.info(channel.groupId, await core.readsGroup(request.user!, channel.groupId));
  });

  app.post<IdParams>('/channels/:id/ai-text', { preHandler: anyUser }, async (request, reply) => {
    const channel = await readableChannel(request, reply);
    if (!channel) return reply;
    if (!(await core.readsGroup(request.user!, channel.groupId))) {
      return fail(reply, 403, ErrorCodes.forbidden);
    }
    return core.rewrite(request, reply, channel.groupId, { channelId: channel.id });
  });

  // Raw audio body, buffered (at most VOICE_LIMITS.maxBytes) and never stored.
  await app.register(async (raw) => {
    raw.removeAllContentTypeParsers();
    raw.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

    raw.post<IdParams>(
      '/channels/:id/transcribe',
      { preHandler: anyUser },
      async (request, reply) => {
        const channel = await readableChannel(request, reply);
        if (!channel) return reply;
        return core.transcribe(request, reply, { channelId: channel.id });
      },
    );
  });

  await app.register(groupTextToolRoutes, { deps, core });
  await app.register(translateRoutes, { deps, core });
  await app.register(adminTextToolRoutes, { deps, core });
};
