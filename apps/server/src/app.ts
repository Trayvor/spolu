import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import type { AppDeps } from './deps.js';
import { attachSocket } from './infra/realtime/socket.js';
import { createAuth, type Auth } from './modules/auth/auth.js';
import { aiRoutes } from './modules/ai/routes.js';
import { textToolRoutes } from './modules/ai/text-routes.js';
import { bulkEmailRenderRoutes } from './modules/bulk-email/render-routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { attachBulkRealtime } from './modules/bulk-email/events.js';
import { bulkEmailRoutes } from './modules/bulk-email/routes.js';
import { bulkEmailUnsubscribeRoutes } from './modules/bulk-email/unsubscribe-routes.js';
import { chatRoutes } from './modules/chat/routes.js';
import { filesRoutes } from './modules/files/routes.js';
import { joinRoutes } from './modules/groups/join-routes.js';
import { registerReminderSource } from './modules/home/reminder-source.js';
import { homeRoutes } from './modules/home/routes.js';
import { groupsRoutes } from './modules/groups/routes.js';
import { registerKnowledgeChatFiles } from './modules/knowledge/chat-files.js';
import { registerKnowledgeReminderSubject } from './modules/knowledge/reminder-subject.js';
import { createRateLimiter } from './infra/http/rate-limit.js';
import { knowledgeRoutes } from './modules/knowledge/routes.js';
import { attachMeetingsRealtime } from './modules/knowledge/meeting-realtime.js';
import { meetingRoutes } from './modules/knowledge/meeting-routes.js';
import { notificationsRoutes } from './modules/notifications/routes.js';
import { attachRemindersRealtime } from './modules/reminders/realtime.js';
import { remindersRoutes } from './modules/reminders/routes.js';
import { countUpcomingForUser, listUpcomingForUser } from './modules/reminders/service.js';
import { registerTaskReminderSubject } from './modules/tasks/reminder-subject.js';
import { systemRoutes } from './modules/system/routes.js';
import { tasksRoutes } from './modules/tasks/routes.js';
import { registerTicketChat } from './modules/tickets/chat.js';
import { registerTicketNotifications } from './modules/tickets/notify.js';
import { ticketsRoutes } from './modules/tickets/routes.js';
import { usersRoutes } from './modules/users/routes.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Builds the HTTP app and attaches Socket.IO (`app.io`); `app.close()` closes both. */
export async function buildApp(
  deps: AppDeps,
  options: { logger?: boolean; logStream?: { write(line: string): void } } = {},
): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    // `logStream` (tests) captures the info log as JSON lines.
    logger: options.logStream
      ? { level: 'info', stream: options.logStream }
      : (options.logger ?? config.nodeEnv !== 'test')
        ? { level: 'info' }
        : false,
    // The app port is reachable only through Caddy (deploy/docker-compose.yml publishes just
    // Caddy's ports). Trust one hop: Caddy's X-Forwarded-For entry is the real client, anything
    // a client prepended before it is ignored.
    // (A function: Fastify treats a plain number as "trust nothing".)
    trustProxy: (_address, hop) => hop < 1,
    // A bulk email unsubscribe token (`<userId>.<campaignId>.<sig>`) is about 115 characters;
    // Fastify's default (100) would answer 414.
    maxParamLength: 256,
  });

  app.decorate('auth', createAuth(deps));
  app.decorate('io', attachSocket(app, config, app.auth, deps.db));
  // preClose runs before Fastify waits for the HTTP server, which open websockets would block.
  // io.close() also closes the HTTP server and is safe when the app never listened.
  // The fire job reaches the sockets through the reminders module (jobs are built before the app).
  attachRemindersRealtime(app.io);
  attachBulkRealtime(app.io); // the bulk batch job's bulk:updated
  attachMeetingsRealtime(app.io); // the meeting jobs' knowledge:item (Phase 30)
  app.addHook('preClose', async () => {
    attachRemindersRealtime(null);
    attachBulkRealtime(null);
    attachMeetingsRealtime(null);
    await app.io.close();
  });

  app.decorateRequest('user', null);
  registerCsrfGuard(app, config);

  await app.register(systemRoutes, { prefix: '/api', deps });
  await app.register(authRoutes, { prefix: '/api', deps });
  await app.register(usersRoutes, { prefix: '/api', deps });
  await app.register(groupsRoutes, { prefix: '/api', deps });
  await app.register(filesRoutes, { prefix: '/api', deps });
  await app.register(joinRoutes, { prefix: '/api', deps });
  await app.register(tasksRoutes, { prefix: '/api', deps });
  await app.register(chatRoutes, { prefix: '/api', deps });
  await app.register(notificationsRoutes, { prefix: '/api', deps });
  await app.register(aiRoutes, { prefix: '/api', deps });
  await app.register(textToolRoutes, { prefix: '/api', deps });
  await app.register(ticketsRoutes, { prefix: '/api', deps });
  await app.register(bulkEmailRoutes, { prefix: '/api', deps });
  await app.register(bulkEmailRenderRoutes, { prefix: '/api', deps });
  await app.register(bulkEmailUnsubscribeRoutes, { prefix: '/api', deps });
  // Knowledge writes and reminder subscription changes share one limit: 120 a minute per user.
  const allowKnowledgeWrite = createRateLimiter({ windowMs: 60_000, max: 120 });
  await app.register(knowledgeRoutes, { prefix: '/api', deps, allowWrite: allowKnowledgeWrite });
  await app.register(meetingRoutes, { prefix: '/api', deps });
  // The reminder endpoints are registered per subject: register the subjects first.
  registerKnowledgeReminderSubject();
  registerTaskReminderSubject();
  // The ticket chat's access rules and its create/move hook, then the ticket notifications
  // (Phase 21): the chat exists before anyone hears about the ticket.
  registerTicketChat();
  // Files attached in any chat become "From chat" knowledge items.
  registerKnowledgeChatFiles();
  registerTicketNotifications();
  await app.register(remindersRoutes, {
    prefix: '/api',
    deps,
    allowWrite: allowKnowledgeWrite,
  });

  // The dashboard's reminders card reads the reminders module through this slot (Phase 20).
  registerReminderSource({
    upcoming: (db, actor, opts) => listUpcomingForUser(db, actor, opts),
    countNextWeek: (db, actor, from) =>
      countUpcomingForUser(db, actor, { from, to: new Date(from.getTime() + WEEK_MS) }),
  });
  await app.register(homeRoutes, { prefix: '/api', deps });

  registerNotFound(app);
  return app;
}

/**
 * CSRF guard for our own state-changing routes (the session cookie is SameSite=Lax, this is
 * defence in depth). A browser sends Sec-Fetch-Site and Origin on such requests; refuse when
 * either says the request came from elsewhere. Requests with neither header (curl, tests)
 * pass. /api/auth/* is skipped: better-auth checks Origin itself. The bulk email unsubscribe
 * and subscribe POSTs are skipped too: their signed token is the credential, they use no
 * session, and mail providers send the RFC 8058 one-click from their own servers.
 */
const TOKEN_POSTS = ['/api/bulk-email/unsubscribe/', '/api/bulk-email/subscribe/'];

function registerCsrfGuard(app: FastifyInstance, config: AppDeps['config']): void {
  const allowedOrigins = new Set([new URL(config.publicUrl).origin]);
  // In dev the browser is on Vite (:5173), whose proxy keeps the page's Origin header.
  if (config.nodeEnv === 'development') allowedOrigins.add('http://localhost:5173');
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

  app.addHook('onRequest', async (request, reply) => {
    if (safeMethods.has(request.method)) return;
    const path = request.url.split('?')[0] ?? '/';
    if (!isUnder(path, '/api') || isUnder(path, '/api/auth')) return;
    if (TOKEN_POSTS.some((prefix) => path.startsWith(prefix))) return;
    const site = request.headers['sec-fetch-site'];
    const origin = request.headers.origin;
    const crossSite = site !== undefined && site !== 'same-origin' && site !== 'none';
    const foreignOrigin = origin !== undefined && !allowedOrigins.has(origin);
    if (crossSite || foreignOrigin) return reply.code(403).send({ error: 'forbidden' });
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
    /** The better-auth instance (`modules/auth/auth.ts`). */
    auth: Auth;
    /** Set by registerStatic: answers client-route requests with index.html. */
    spaFallback: ((reply: FastifyReply) => FastifyReply) | null;
  }
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The single not-found handler. Unknown /api/*, /socket.io/*, non-GET requests and anything
 * that looks like a file (a dot in the last segment, except /unsubscribe/<token>) answer JSON
 * 404. Other GET/HEAD requests get the SPA index.html,
 * but only when static serving is registered.
 */
function registerNotFound(app: FastifyInstance): void {
  app.decorate('spaFallback', null);
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    const isClientRoute =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !isUnder(path, '/api') &&
      !isUnder(path, '/socket.io') &&
      !path.startsWith('/assets/') &&
      // The unsubscribe page's token has dots (`<user>.<campaign>.<sig>`) but is no file.
      (path.startsWith('/unsubscribe/') || !(path.split('/').pop() ?? '').includes('.'));
    if (isClientRoute && app.spaFallback) return app.spaFallback(reply);
    return reply.code(404).send({ error: 'not_found' });
  });
}
