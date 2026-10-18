import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCodes, UserLanguages, type PublicMeeting, type UserLanguage } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { serverTexts } from '../../infra/i18n/index.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { buildIcsText, icsFilename } from '../reminders/ics.js';
import { CALENDAR_TOKEN, calendarTokenHash, isCalendarToken } from './calendar-token.js';
import { linkByCalendarHash, type LinkRow } from './service.js';
import type { MeetingForTeams } from '../knowledge/meeting-teams.js';

type TokenParams = { Params: { token: string }; Querystring: { lang?: string } };

/** Calls a minute per IP of both public routes. */
const PUBLIC_PER_MINUTE = 60;

/**
 * Teams T1: the public add-to-calendar page of a meeting Help created (`/m/<token>`, no
 * sign-in). Only the token is checked, and only the title, the time, the join link and whether
 * the call is recorded are given (owner answer 7): no notes, transcript, group or organizer.
 * Inert (404) while Teams is not configured.
 */
export const teamsPublicRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, config } = deps;
  const allow = createRateLimiter({ windowMs: 60_000, max: PUBLIC_PER_MINUTE });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });

  async function resolve(
    request: FastifyRequest<TokenParams>,
    reply: FastifyReply,
  ): Promise<{ row: LinkRow; meeting: MeetingForTeams } | null> {
    if (!allow(request.ip)) {
      await reply.code(429).send({ error: ErrorCodes.rateLimited });
      return null;
    }
    const token = request.params.token;
    if (!deps.teams || !config.teams || !CALENDAR_TOKEN.test(token)) {
      await notFound(reply);
      return null;
    }
    const found = await linkByCalendarHash(db, calendarTokenHash(token));
    if (!found || !isCalendarToken(config.appSecret, found.row, token)) {
      await notFound(reply);
      return null;
    }
    reply.header('cache-control', 'no-store');
    reply.header('x-robots-tag', 'noindex');
    return found;
  }

  const endOf = (row: LinkRow, meeting: MeetingForTeams) =>
    new Date(meeting.startsAt.getTime() + row.durationMinutes * 60_000);

  app.get<TokenParams>('/public/meetings/:token', async (request, reply) => {
    const found = await resolve(request, reply);
    if (!found) return reply;
    const { row, meeting } = found;
    const body: PublicMeeting = {
      title: meeting.title,
      startsAt: meeting.startsAt.toISOString(),
      endsAt: endOf(row, meeting).toISOString(),
      joinUrl: row.joinUrl,
      recorded: row.recordAutomatically,
    };
    return body;
  });

  app.get<TokenParams>('/public/meetings/:token/invite.ics', async (request, reply) => {
    const found = await resolve(request, reply);
    if (!found) return reply;
    const { row, meeting } = found;
    const lang = (UserLanguages as readonly string[]).includes(request.query.lang ?? '')
      ? (request.query.lang as UserLanguage)
      : 'sk';
    const texts = serverTexts(lang).teams;
    const notice = row.recordAutomatically ? texts.recordingNotice : texts.recordingMayNotice;
    const text = buildIcsText({
      now: new Date(),
      events: [
        {
          // The event's iCalUId: who also got the Outlook invitation keeps one event.
          uid: row.icalUid ?? `teams-${row.itemId}@spolu`,
          title: meeting.title,
          description: `${notice}\n\n${texts.join} ${row.joinUrl}`,
          url: row.joinUrl,
          updatedAt: meeting.updatedAt > row.createdAt ? meeting.updatedAt : row.createdAt,
          start: meeting.startsAt,
          end: endOf(row, meeting),
          location: 'Microsoft Teams',
          alarm: false,
        },
      ],
    });
    return reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .header('content-disposition', `attachment; filename="${icsFilename(meeting.title)}"`)
      .send(text);
  });
};
