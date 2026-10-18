import { eq, inArray, sql } from 'drizzle-orm';
import type {
  SessionUser,
  TeamsCreateBody,
  TeamsInviteeOption,
  TeamsLink,
  TeamsMeetingState,
  TeamsTranscriptState,
} from '@spolu/shared';
import type { Config } from '../../infra/config/config.js';
import type { Db } from '../../infra/db/client.js';
import { serverTexts, type ServerTexts } from '../../infra/i18n/index.js';
import { listPickablePeople } from '../groups/service.js';
import {
  getMeetingForTeams,
  meetingForTeamsAction,
  setMeetingUrlFromTeams,
  type MeetingForTeams,
} from '../knowledge/meeting-teams.js';
import { KnowledgeForbiddenError, KnowledgeNotFoundError } from '../knowledge/errors.js';
import { getUserById, userEmails } from '../users/service.js';
import { canLinkTeamsMeeting, canManageTeamsLink, canPlanTeamsSeries } from './policy.js';
import { calendarToken, calendarTokenHash, newCalendarNonce } from './calendar-token.js';
import {
  TeamsInvalidLinkError,
  TeamsLinkedError,
  TeamsMeetingLinkedError,
  TeamsMeetingNotFoundError,
  TeamsNotOrganizerError,
  TeamsOutsideTenantError,
  TeamsUnavailableError,
  TeamsUnknownOrganizerError,
} from './errors.js';
import { GraphError, type GraphOnlineMeeting, type TeamsGraph } from './graph-client.js';
import { parseTeamsLink } from './links.js';
import { knownOrganizers, organizerOf, type Organizer } from './organizers.js';
import { nextPollAt } from './schedule.js';
import { teamsMeetingLinks, teamsSeriesPlans } from './schema.js';

// Teams T1: create a Teams meeting for a knowledge meeting item, connect a pasted link, show
// and drop the connection. The item stays the user-facing object (owner answer 6).

export type TeamsDeps = { db: Db; config: Config; graph: TeamsGraph };
export type LinkRow = typeof teamsMeetingLinks.$inferSelect;

/** The meeting's Teams row, or null. */
export async function getLink(db: Db, itemId: string): Promise<LinkRow | null> {
  const [row] = await db
    .select()
    .from(teamsMeetingLinks)
    .where(eq(teamsMeetingLinks.itemId, itemId));
  return row ?? null;
}

/** The item that already follows this Teams meeting, or null. */
async function itemOfOnlineMeeting(db: Db, onlineMeetingId: string): Promise<string | null> {
  const [row] = await db
    .select({ itemId: teamsMeetingLinks.itemId })
    .from(teamsMeetingLinks)
    .where(eq(teamsMeetingLinks.onlineMeetingId, onlineMeetingId));
  return row?.itemId ?? null;
}

/**
 * An insert that hit a unique key: this item got a Teams meeting meanwhile (`teams_linked`), or
 * the Teams meeting went to another item (`teams_meeting_linked`).
 */
async function insertConflict(db: Db, itemId: string): Promise<never> {
  if (await getLink(db, itemId)) throw new TeamsLinkedError();
  throw new TeamsMeetingLinkedError();
}

/** The public add-to-calendar page of a Help-made meeting. */
export function invitationUrl(config: Config, row: Pick<LinkRow, 'itemId' | 'calendarNonce'>) {
  if (!row.calendarNonce) return null;
  return `${config.publicUrl}/m/${calendarToken(config.appSecret, row.itemId, row.calendarNonce)}`;
}

export function toTeamsLink(config: Config, row: LinkRow): TeamsLink {
  return {
    origin: row.origin as TeamsLink['origin'],
    joinUrl: row.joinUrl,
    organizerName: row.organizerName,
    durationMinutes: row.durationMinutes,
    recordAutomatically: row.recordAutomatically,
    transcriptState: row.transcriptState as TeamsTranscriptState,
    lastError: row.lastError,
    lastCheckedAt: row.lastPolledAt?.toISOString() ?? null,
    nextCheckAt: row.nextPollAt?.toISOString() ?? null,
    invitationUrl: invitationUrl(config, row),
  };
}

/** The Teams block of a meeting the admin may edit (the route checked `canUseTeams`). */
export async function teamsState(
  deps: TeamsDeps,
  actor: SessionUser,
  itemId: string,
): Promise<TeamsMeetingState> {
  const meeting = await meetingForTeamsAction(deps.db, actor, itemId);
  const row = await getLink(deps.db, itemId);
  const state: TeamsMeetingState = { link: row ? toTeamsLink(deps.config, row) : null };
  // Recurring calls (ADR 0049): only a call of a series has the series part.
  if (meeting.seriesId !== null) {
    const plan = await getSeriesPlan(deps.db, meeting.seriesId);
    state.series = {
      planned: plan !== null,
      organizerName: plan?.organizerName ?? null,
      lastError: plan?.lastError ?? null,
    };
  }
  return state;
}

/** The Teams plan of a series, or null. */
export async function getSeriesPlan(db: Db, seriesId: string) {
  const [row] = await db
    .select()
    .from(teamsSeriesPlans)
    .where(eq(teamsSeriesPlans.seriesId, seriesId));
  return row ?? null;
}

/**
 * Whom the create dialog offers to invite: the group's clients and managers, with their emails
 * (owner answer 4: nobody is preselected; free emails are typed in the dialog).
 */
export async function inviteeOptions(
  deps: TeamsDeps,
  actor: SessionUser,
  itemId: string,
): Promise<TeamsInviteeOption[]> {
  const meeting = await meetingForTeamsAction(deps.db, actor, itemId);
  const people = await listPickablePeople(deps.db, meeting.groupId);
  const emails = await userEmails(
    deps.db,
    people.map((p) => p.id),
  );
  return people.flatMap((p) => {
    const email = emails.get(p.id);
    return email ? [{ id: p.id, name: p.name, email, isAdmin: p.isAdmin }] : [];
  });
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** The invitation's body (HTML; Outlook adds the Teams join block under it). */
export function invitationHtml(
  texts: ServerTexts,
  input: { recorded: boolean; calendarUrl: string },
): string {
  const notice = input.recorded ? texts.teams.recordingNotice : texts.teams.recordingMayNotice;
  const url = escapeHtml(input.calendarUrl);
  return [
    `<p><strong>${escapeHtml(notice)}</strong></p>`,
    `<p>${escapeHtml(texts.teams.addToCalendar)} <a href="${url}">${url}</a></p>`,
  ].join('');
}

/** A Graph failure of an organizer action: 403/404 mean the account is not enabled. */
function organizerFailure(error: unknown): never {
  if (error instanceof GraphError) {
    if (error.status === 403 || error.status === 404) throw new TeamsNotOrganizerError();
    throw new TeamsUnavailableError(error.code);
  }
  throw error;
}

async function actorOrganizer(deps: TeamsDeps, actor: SessionUser): Promise<Organizer> {
  let organizer: Organizer | null;
  try {
    organizer = await organizerOf(deps, actor);
  } catch (error) {
    organizerFailure(error);
  }
  if (!organizer) throw new TeamsNotOrganizerError();
  return organizer;
}

/**
 * The policy check of a create or connect, after `meetingForTeamsAction` proved the item is
 * editable: an existing Teams meeting is 409, any other refusal 403.
 */
async function ensureCanLink(deps: TeamsDeps, actor: SessionUser, itemId: string): Promise<void> {
  const linked = (await getLink(deps.db, itemId)) !== null;
  const context = { configured: deps.config.teams !== null, canEditItem: true, linked };
  if (canLinkTeamsMeeting(actor, context)) return;
  throw linked ? new TeamsLinkedError() : new KnowledgeForbiddenError();
}

/** The same for "Check now" and "Disconnect": no Teams meeting is 404. */
export async function ensureCanManage(
  deps: TeamsDeps,
  actor: SessionUser,
  itemId: string,
): Promise<LinkRow> {
  const row = await getLink(deps.db, itemId);
  const context = { configured: deps.config.teams !== null, canEditItem: true, linked: !!row };
  if (!row) throw new KnowledgeNotFoundError();
  if (!canManageTeamsLink(actor, context)) throw new KnowledgeForbiddenError();
  return row;
}

/**
 * "Create Teams meeting": a calendar event with Teams in the organizer's (the acting admin's)
 * calendar, so Outlook invites the people picked and the transcript can be read later; the
 * recording notice in its body; automatic recording when asked (default on). The join URL
 * becomes the meeting's link.
 */
export async function createTeamsMeeting(
  deps: TeamsDeps,
  actor: SessionUser,
  itemId: string,
  body: TeamsCreateBody,
  now: Date = new Date(),
): Promise<TeamsMeetingState> {
  const { db, config } = deps;
  const meeting = await meetingForTeamsAction(db, actor, itemId);
  await ensureCanLink(deps, actor, itemId);
  const following = body.following && meeting.seriesId !== null && meeting.seriesIndex !== null;
  if (
    following &&
    !canPlanTeamsSeries(actor, {
      configured: config.teams !== null,
      canEditItem: true,
      inSeries: true,
    })
  ) {
    throw new KnowledgeForbiddenError();
  }
  const organizer = await actorOrganizer(deps, actor);
  const nonce = newCalendarNonce();
  const row = await createHelpEvent(
    deps,
    {
      meeting,
      organizer: {
        userId: actor.id,
        entraUserId: organizer.entraUserId,
        name: organizer.displayName ?? actor.name,
      },
      settings: body,
      nonce,
      transactionId: `${itemId}-${nonce}`,
      createdBy: actor.id,
    },
    now,
  );
  // Another admin connected it meanwhile; the event stays in this organizer's Outlook.
  if (!row) await insertConflict(db, itemId);
  if (following) {
    // ADR 0049: the later calls of the series get theirs from the Teams series job.
    const plan = {
      organizerUserId: actor.id,
      organizerEntraId: organizer.entraUserId,
      organizerName: organizer.displayName ?? actor.name,
      durationMinutes: body.durationMinutes,
      recordAutomatically: body.recordAutomatically,
      attendees: body.attendees,
      nextIndex: meeting.seriesIndex! + 1,
      lastError: null,
    };
    await db
      .insert(teamsSeriesPlans)
      .values({ seriesId: meeting.seriesId!, ...plan })
      .onConflictDoUpdate({
        target: teamsSeriesPlans.seriesId,
        set: { ...plan, updatedAt: sql`now()` },
      });
  }
  return teamsState(deps, actor, itemId);
}

/** The settings of a Help-made Teams meeting (the create dialog's, or a series plan's). */
type EventSettings = Pick<TeamsCreateBody, 'durationMinutes' | 'attendees' | 'recordAutomatically'>;

/**
 * Creates the Outlook event with Teams for `meeting` in the organizer's calendar and stores the
 * link; the join URL becomes the meeting's link. Null when the meeting got a Teams meeting
 * meanwhile (nothing stored). `transactionId` makes Graph answer a retried create with the
 * same event; the series job passes a fixed one and a fixed nonce per call, so a run that
 * failed after Graph's answer converges on one event.
 */
export async function createHelpEvent(
  deps: TeamsDeps,
  args: {
    meeting: MeetingForTeams;
    organizer: { userId: string; entraUserId: string; name: string | null };
    settings: EventSettings;
    nonce: string;
    transactionId: string;
    createdBy: string;
  },
  now: Date = new Date(),
): Promise<LinkRow | null> {
  const { db, config, graph } = deps;
  const { meeting, organizer, settings: body, nonce } = args;
  const itemId = meeting.itemId;
  const language = (await getUserById(db, organizer.userId))?.language ?? 'sk';
  const calendarUrl = invitationUrl(config, { itemId, calendarNonce: nonce })!;
  const attendees = [...new Map(body.attendees.map((a) => [a.email, a])).values()];
  const end = new Date(meeting.startsAt.getTime() + body.durationMinutes * 60_000);
  let event;
  try {
    event = await graph.createEvent(organizer.entraUserId, {
      subject: meeting.title,
      bodyHtml: invitationHtml(serverTexts(language), {
        recorded: body.recordAutomatically,
        calendarUrl,
      }),
      start: meeting.startsAt,
      end,
      attendees,
      transactionId: args.transactionId.slice(0, 120),
    });
  } catch (error) {
    organizerFailure(error);
  }
  if (!event.joinUrl) throw new TeamsUnavailableError('no_join_url');

  // The online meeting behind the event: needed for the recording switch and the transcripts.
  // When Graph does not list it yet, the poll job looks it up again.
  let online: GraphOnlineMeeting | null = null;
  let lastError: string | null = null;
  try {
    online = await graph.findOnlineMeeting(organizer.entraUserId, { joinWebUrl: event.joinUrl });
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    lastError = error.code;
  }
  let recordApplied = false;
  if (online && body.recordAutomatically) {
    try {
      await graph.setRecordAutomatically(organizer.entraUserId, online.id, true);
      recordApplied = true;
    } catch (error) {
      if (!(error instanceof GraphError)) throw error;
      lastError = error.code;
    }
  }
  const times = { startsAt: meeting.startsAt, durationMinutes: body.durationMinutes };
  const inserted = await db
    .insert(teamsMeetingLinks)
    .values({
      itemId,
      origin: 'help',
      organizerUserId: organizer.userId,
      organizerEntraId: organizer.entraUserId,
      organizerName: organizer.name,
      onlineMeetingId: online?.id ?? null,
      joinUrl: event.joinUrl,
      eventId: event.id,
      icalUid: event.iCalUId,
      durationMinutes: body.durationMinutes,
      recordAutomatically: body.recordAutomatically,
      recordApplied,
      startsAt: meeting.startsAt,
      nextPollAt: nextPollAt(now, times),
      lastError,
      calendarNonce: nonce,
      calendarTokenHash: calendarTokenHash(calendarToken(config.appSecret, itemId, nonce)),
      createdBy: args.createdBy,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return null;
  await setMeetingUrlFromTeams(db, itemId, event.joinUrl);
  return inserted[0]!;
}

/**
 * "Stop for the following calls" (ADR 0049): the Teams series job creates no more Teams
 * meetings for the call's series. The ones made stay (each call keeps its own).
 */
export async function stopTeamsSeries(
  deps: TeamsDeps,
  actor: SessionUser,
  itemId: string,
): Promise<void> {
  const meeting = await meetingForTeamsAction(deps.db, actor, itemId);
  if (meeting.seriesId === null) throw new KnowledgeNotFoundError();
  const context = { configured: deps.config.teams !== null, canEditItem: true, inSeries: true };
  if (!canPlanTeamsSeries(actor, context)) throw new KnowledgeForbiddenError();
  await deps.db.delete(teamsSeriesPlans).where(eq(teamsSeriesPlans.seriesId, meeting.seriesId));
}

/** Graph's meeting length in minutes, when it states a sensible one. */
function durationOf(online: GraphOnlineMeeting): number | null {
  if (!online.startDateTime || !online.endDateTime) return null;
  const minutes = Math.round(
    (Date.parse(online.endDateTime) - Date.parse(online.startDateTime)) / 60_000,
  );
  return Number.isFinite(minutes) && minutes >= 5 && minutes <= 24 * 60 ? minutes : null;
}

/**
 * "Connect Teams link": resolves a pasted join link to its online meeting through the known
 * organizers (Help's admins). Refused: no Teams link, another tenant or personal Teams, an
 * organizer who is none of Help's admins, or nobody sees the meeting.
 */
export async function connectTeamsMeeting(
  deps: TeamsDeps,
  actor: SessionUser,
  itemId: string,
  url: string,
  now: Date = new Date(),
): Promise<TeamsMeetingState> {
  const { db, config, graph } = deps;
  const meeting: MeetingForTeams = await meetingForTeamsAction(db, actor, itemId);
  await ensureCanLink(deps, actor, itemId);
  const parsed = parseTeamsLink(url);
  if (!parsed) throw new TeamsInvalidLinkError();
  const tenantId = config.teams!.tenantId;
  if (parsed.kind === 'personal') throw new TeamsOutsideTenantError();
  if (parsed.kind === 'classic' && parsed.tenantId && parsed.tenantId !== tenantId) {
    throw new TeamsOutsideTenantError();
  }

  const organizers = await knownOrganizers(deps, actor, now);
  const byEntraId = new Map(organizers.map((o) => [o.entraUserId, o]));
  let candidates = organizers;
  if (parsed.kind === 'classic' && parsed.organizerId) {
    // The link names its organizer: only that account is asked, and only when Help knows it.
    const hinted = byEntraId.get(parsed.organizerId);
    if (!hinted) throw new TeamsUnknownOrganizerError();
    candidates = [hinted];
  }

  let online: GraphOnlineMeeting | null = null;
  for (const candidate of candidates) {
    try {
      online = await graph.findOnlineMeeting(
        candidate.entraUserId,
        parsed.kind === 'meet'
          ? { joinMeetingId: parsed.joinMeetingId }
          : { joinWebUrl: parsed.joinWebUrl },
      );
      if (online) break;
    } catch (error) {
      // Not this organizer's (no access policy for them, or not found): ask the next one.
      if (!(error instanceof GraphError)) throw error;
      if (error.status !== 403 && error.status !== 404) throw new TeamsUnavailableError(error.code);
    }
  }
  if (!online) throw new TeamsMeetingNotFoundError();
  if (online.organizerTenantId && online.organizerTenantId !== tenantId) {
    throw new TeamsOutsideTenantError();
  }
  // The organizer Graph states is stored, never the link's hint nor the account asked: a
  // meeting whose organizer Graph leaves out is refused.
  if (!online.organizerId) throw new TeamsUnknownOrganizerError();
  const organizer = byEntraId.get(online.organizerId);
  if (!organizer) throw new TeamsUnknownOrganizerError();
  // One Teams meeting follows one item: a second item would import the same transcript.
  if (await itemOfOnlineMeeting(db, online.id)) throw new TeamsMeetingLinkedError();

  const durationMinutes = durationOf(online) ?? 60;
  const inserted = await db
    .insert(teamsMeetingLinks)
    .values({
      itemId,
      origin: 'linked',
      organizerUserId: organizer.userId,
      organizerEntraId: organizer.entraUserId,
      organizerName: organizer.displayName,
      onlineMeetingId: online.id,
      joinUrl: online.joinWebUrl || parsed.joinWebUrl,
      startsAt: meeting.startsAt,
      durationMinutes,
      nextPollAt: nextPollAt(now, { startsAt: meeting.startsAt, durationMinutes }),
      createdBy: actor.id,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) await insertConflict(db, itemId);
  if (meeting.meetingUrl === null) await setMeetingUrlFromTeams(db, itemId, parsed.joinWebUrl);
  return { link: toTeamsLink(config, inserted[0]!) };
}

/**
 * "Disconnect": Help stops following the Teams meeting and its public page stops working. The
 * meeting itself stays in Outlook and Teams (MVP: cancelling it is T2).
 */
export async function disconnectTeamsMeeting(
  deps: TeamsDeps,
  actor: SessionUser,
  itemId: string,
): Promise<void> {
  await meetingForTeamsAction(deps.db, actor, itemId);
  await ensureCanManage(deps, actor, itemId);
  await deps.db.delete(teamsMeetingLinks).where(eq(teamsMeetingLinks.itemId, itemId));
}

/** For the public page: the row of a calendar token's hash, and its meeting. */
export async function linkByCalendarHash(
  db: Db,
  hash: string,
): Promise<{ row: LinkRow; meeting: MeetingForTeams } | null> {
  const [row] = await db
    .select()
    .from(teamsMeetingLinks)
    .where(eq(teamsMeetingLinks.calendarTokenHash, hash));
  if (!row) return null;
  const meeting = await getMeetingForTeams(db, row.itemId);
  return meeting ? { row, meeting } : null;
}

/**
 * The length in minutes of the Teams meeting of each of `itemIds` that has one (the personal
 * calendar feed's call ends, ADR 0051): one read of `teams_meeting_links` by its primary key.
 */
export async function meetingDurations(db: Db, itemIds: string[]): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db
    .select({ itemId: teamsMeetingLinks.itemId, minutes: teamsMeetingLinks.durationMinutes })
    .from(teamsMeetingLinks)
    .where(inArray(teamsMeetingLinks.itemId, [...new Set(itemIds)]));
  return new Map(rows.map((r) => [r.itemId, r.minutes]));
}
