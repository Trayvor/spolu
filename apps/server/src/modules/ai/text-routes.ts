import { performance } from 'node:perf_hooks';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  AiTextBodySchema,
  ErrorCodes,
  ID_RE,
  VOICE_LIMITS,
  type AiTextResult,
  type AiToolsInfo,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter, createSlidingRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { actorReadsChannel } from '../chat/access.js';
import { getChannel, type ChannelRow } from '../chat/service.js';
import { clientGroupIds } from '../groups/memberships.js';
import { canReadGroup } from '../groups/policy.js';
import { clientLanguages, getGroup } from '../groups/service.js';
import { isAdmin } from '../users/policy.js';
import { clientLanguageOf, isSlovakInstance, languageName } from './client-language.js';
import { AiFailedError, AiTimeoutError } from './provider.js';
import { TEXT_TOOLS_TIMEOUT_MS, withTimeout, type TextToolRequest } from './text-tools.js';

type IdParams = { Params: { id: string } };
type Outcome = 'ok' | 'failed' | 'timeout';

/** Per user: a burst limit and a daily cap (owner decision, Phase 28 design). */
export const TEXT_TOOL_LIMITS = { perMinute: 20, perDay: 300 } as const;
export const VOICE_RATE_LIMITS = { perMinute: 10, perHour: 60 } as const;
const VOICE_TIMEOUT_MS = 60_000;

const EXTENSIONS: Record<(typeof VOICE_LIMITS.types)[number], string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/**
 * Phase 28: the chat composer's AI text tools (Fix mistakes, Make it formal, Translate) and voice
 * input. The prompts live in the server; the browser sends only the text and the action. Text
 * tools: whoever reads the channel's group (admins and its clients, not a ziadatel). Voice: whoever
 * reads the channel. Every provider call is logged without the text.
 */
export const textToolRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const anyUser = requireUser(app.auth);
  const textPerMinute = createRateLimiter({ windowMs: 60_000, max: TEXT_TOOL_LIMITS.perMinute });
  const textPerDay = createSlidingRateLimiter({
    windowMs: 86_400_000,
    max: TEXT_TOOL_LIMITS.perDay,
  });
  const voicePerMinute = createRateLimiter({ windowMs: 60_000, max: VOICE_RATE_LIMITS.perMinute });
  const voicePerHour = createSlidingRateLimiter({
    windowMs: 3_600_000,
    max: VOICE_RATE_LIMITS.perHour,
  });
  const fail = (reply: FastifyReply, code: number, error: string) =>
    reply.code(code).send({ error });

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

  /** The text tools follow the group: admins and its clients, never a ziadatel. */
  async function readsGroup(request: FastifyRequest, channel: ChannelRow): Promise<boolean> {
    const actor = request.user!;
    const groupIds = isAdmin(actor) ? [] : await clientGroupIds(db, actor.id);
    return canReadGroup(actor, channel.groupId, groupIds);
  }

  /** Translate is offered off `.sk`; `clientLanguage` null means only English. */
  async function translateInfo(channel: ChannelRow): Promise<AiToolsInfo['translate']> {
    const group = await getGroup(db, channel.groupId);
    if (!group || isSlovakInstance(group.egrantUrl)) return null;
    return {
      clientLanguage: clientLanguageOf(group.egrantUrl, await clientLanguages(db, group.id)),
    };
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

  app.get<IdParams>('/channels/:id/ai-tools', { preHandler: anyUser }, async (request, reply) => {
    const channel = await readableChannel(request, reply);
    if (!channel) return reply;
    const text = deps.textTools !== null && (await readsGroup(request, channel));
    const body: AiToolsInfo = {
      text,
      translate: text ? await translateInfo(channel) : null,
      voice: deps.transcription !== null,
    };
    return body;
  });

  app.post<IdParams>('/channels/:id/ai-text', { preHandler: anyUser }, async (request, reply) => {
    const channel = await readableChannel(request, reply);
    if (!channel) return reply;
    if (!(await readsGroup(request, channel))) return fail(reply, 403, ErrorCodes.forbidden);
    const provider = deps.textTools;
    if (provider === null) return fail(reply, 503, ErrorCodes.aiUnavailable);
    const parsed = AiTextBodySchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, ErrorCodes.validationFailed);
    const { action, target, text } = parsed.data;

    let toolRequest: TextToolRequest;
    if (action === 'translate') {
      const translate = await translateInfo(channel);
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
    const fields = { channelId: channel.id, action, target: target ?? null };
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
        const fields = { channelId: channel.id, bytes: size, provider: provider.name };
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
    );
  });
};
