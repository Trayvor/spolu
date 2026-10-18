import { createHmac } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import type { TeamsCreateBody } from '@spolu/shared';
import { getMeetingForTeams } from '../knowledge/meeting-teams.js';
import { listSeriesCalls } from '../knowledge/meeting-series.js';
import { TeamsNotOrganizerError, TeamsUnavailableError } from './errors.js';
import { GraphError } from './graph-client.js';
import { teamsMeetingLinks, teamsSeriesPlans } from './schema.js';
import { createHelpEvent, type TeamsDeps } from './service.js';

// Recurring calls (ADR 0049): one Outlook event with Teams per call of a series, not one
// recurring Graph event. Each call keeps its own online meeting, join link, transcript window,
// recording switch and public page, exactly as a single call; a moved or cancelled call never
// touches the others' events.

export const TEAMS_SERIES_JOB = 'teams.series';

/**
 * The fixed nonce of a call's series-made event: a run that failed after Graph created the
 * event sends the same body and transaction id again, and Graph answers with that event.
 */
const seriesNonce = (appSecret: string, itemId: string) =>
  createHmac('sha256', appSecret)
    .update(`teams-series\0${itemId}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');

/**
 * For every series plan: a Teams meeting for each call of the series from the plan's
 * `next_index` on that has none yet and has not started, in order, as the plan's organizer.
 * The plan's cursor moves past each call handled (made, already connected, or started), so a
 * call is looked at once: one whose Teams meeting an admin disconnected is not given a new one.
 * A Graph failure stops that plan's run and is kept as its `last_error`; the next run (every
 * 5 minutes) tries again. Returns the number of meetings created.
 */
export async function syncTeamsSeries(deps: TeamsDeps, now: Date = new Date()): Promise<number> {
  const { db, config } = deps;
  const plans = await db.select().from(teamsSeriesPlans);
  let created = 0;
  for (const plan of plans) {
    const calls = await listSeriesCalls(db, plan.seriesId, plan.nextIndex);
    if (calls.length === 0) continue;
    const linked = new Set(
      (
        await db
          .select({ itemId: teamsMeetingLinks.itemId })
          .from(teamsMeetingLinks)
          .where(
            inArray(
              teamsMeetingLinks.itemId,
              calls.map((c) => c.itemId),
            ),
          )
      ).map((r) => r.itemId),
    );
    let nextIndex = plan.nextIndex;
    let lastError: string | null = null;
    for (const call of calls) {
      if (call.startsAt.getTime() > now.getTime() && !linked.has(call.itemId)) {
        const meeting = await getMeetingForTeams(db, call.itemId);
        if (meeting) {
          try {
            const nonce = seriesNonce(config.appSecret, call.itemId);
            const row = await createHelpEvent(
              deps,
              {
                meeting,
                organizer: {
                  userId: plan.organizerUserId,
                  entraUserId: plan.organizerEntraId,
                  name: plan.organizerName,
                },
                settings: {
                  durationMinutes: plan.durationMinutes,
                  recordAutomatically: plan.recordAutomatically,
                  attendees: plan.attendees as TeamsCreateBody['attendees'],
                },
                nonce,
                transactionId: `${call.itemId}-series`,
                createdBy: plan.organizerUserId,
              },
              now,
            );
            if (row) created += 1;
          } catch (error) {
            if (error instanceof TeamsNotOrganizerError) lastError = 'teams_not_organizer';
            else if (error instanceof TeamsUnavailableError || error instanceof GraphError) {
              lastError = error.code;
            } else throw error;
            break;
          }
        }
      }
      nextIndex = call.index + 1;
    }
    await db
      .update(teamsSeriesPlans)
      .set({ nextIndex, lastError, updatedAt: sql`now()` })
      .where(eq(teamsSeriesPlans.seriesId, plan.seriesId));
  }
  return created;
}
