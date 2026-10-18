import { randomUUID } from 'node:crypto';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  KnowledgeEvents,
  KnowledgeItemDtoSchema,
  KnowledgePageSchema,
  SocketEvents,
  type KnowledgeItemEvent,
  PublicMeetingSchema,
  TeamsInviteeOptionListSchema,
  TeamsMeetingStateSchema,
  type KnowledgeItemDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import {
  classicLink,
  createFakeGraph,
  OTHER_TENANT,
  TENANT,
  teamsConfig,
  vtt,
  type FakeGraph,
  type FakeUser,
} from '../../../test/teams-graph.js';
import { addManager } from '../groups/managers.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { knowledgeMeetings } from '../knowledge/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';
import { teamsMeetingLinks } from './schema.js';
import { pollDueMeetings } from './transcripts.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; email: string; cookie: string };

const MIN = 60_000;
const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const SK_NOTICE = 'Tento hovor bude nahrávaný a prepisovaný.';
const SK_MAY_NOTICE = 'Tento hovor môže byť nahrávaný a prepisovaný.';

describe('Microsoft Teams (T1)', () => {
  let test: TestApp;
  /** The same app without Teams configured: everything Teams is inert. */
  let off: TestApp;
  let graph: FakeGraph;
  let baseUrl = '';
  const sockets: Socket[] = [];

  beforeAll(async () => {
    graph = createFakeGraph();
    // One after the other: the meeting jobs' socket slot is the last app's (`test`).
    off = await buildTestApp();
    test = await buildTestApp({ config: { teams: teamsConfig() }, teamsFetch: graph.fetch });
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await Promise.all([test.app.close(), off.app.close()]);
    await Promise.all([test.close(), off.close()]);
  });
  beforeEach(() => {
    graph.calls.length = 0;
    graph.networkDown = false;
  });

  /** A signed-in socket recording the knowledge rows it gets. */
  async function knowledgeRows(cookie: string, joinGroupId?: string) {
    const socket = connectSocket(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', () => resolve(null)));
    if (joinGroupId) {
      expect(await socket.emitWithAck(SocketEvents.groupJoin, { groupId: joinGroupId })).toEqual({
        ok: true,
      });
    }
    const rows: KnowledgeItemEvent['item'][] = [];
    socket.on(KnowledgeEvents.item, (event: KnowledgeItemEvent) => rows.push(event.item));
    return rows;
  }
  const until = async (check: () => boolean, ms = 3000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie?: string,
    payload?: unknown,
    app: TestApp = test,
  ) =>
    app.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  /** A Help admin; with `microsoft` also a Microsoft account (in the organizers group or not). */
  async function newAdmin(
    microsoft: 'group' | 'outside' | 'none' = 'group',
    app: TestApp = test,
  ): Promise<Person & { ms: FakeUser | null }> {
    const email = newEmail();
    const admin = await addAdmin(app.deps.db, { email, name: 'Teams Admin' });
    const ms =
      microsoft === 'none' ? null : graph.addUser(email, 'Jana Admin', microsoft === 'group');
    return { id: admin.id, email, cookie: await loginAs(app.app, email), ms };
  }

  async function member(groupId: string, role: 'client' | 'ziadatel' = 'client', app = test) {
    const email = newEmail();
    const c = await createUnverifiedClient(app.deps.db, email);
    await app.deps.db
      .update(user)
      .set({ name: 'Klient Firmy', emailVerified: true })
      .where(eq(user.id, c.id));
    await addMembership(app.deps.db, c.id, groupId, role);
    return { id: c.id, email, cookie: await loginAs(app.app, email) };
  }

  const newGroup = (app: TestApp = test) =>
    createGroup(app.deps.db, { name: 'Firma s.r.o.', egrantUrl: newUrl() });

  async function newMeeting(
    cookie: string,
    groupId: string,
    fields: Record<string, unknown> = {},
    app: TestApp = test,
  ): Promise<KnowledgeItemDto> {
    const res = await call(
      'POST',
      `/api/groups/${groupId}/knowledge`,
      cookie,
      {
        type: 'meeting',
        title: 'Kickoff Mesto X',
        body: 'Interná poznámka: rozpočet 40 000 €',
        meeting: { startsAt: inHours(24), ...fields },
      },
      app,
    );
    expect(res.statusCode, res.body).toBe(201);
    return KnowledgeItemDtoSchema.parse(res.json());
  }

  const getItem = async (cookie: string, id: string) => {
    const res = await call('GET', `/api/knowledge/${id}`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return KnowledgeItemDtoSchema.parse(res.json());
  };

  const createTeams = (cookie: string, id: string, body: Record<string, unknown> = {}) =>
    call('POST', `/api/knowledge/${id}/teams/meeting`, cookie, body);
  const connect = (cookie: string, id: string, url: string) =>
    call('POST', `/api/knowledge/${id}/teams/connect`, cookie, { url });
  const linkRow = async (id: string) =>
    (
      await test.deps.db.select().from(teamsMeetingLinks).where(eq(teamsMeetingLinks.itemId, id))
    )[0];
  const graphDeps = () => ({ db: test.deps.db, graph: test.deps.teams! });

  describe('inactive without configuration', () => {
    it('every Teams route is 404 and the meeting works as before', async () => {
      const group = await newGroup(off);
      const admin = await newAdmin('group', off);
      const item = await newMeeting(admin.cookie, group.id, {}, off);
      for (const [method, path, body] of [
        ['GET', `/api/knowledge/${item.id}/teams`, undefined],
        ['GET', `/api/knowledge/${item.id}/teams/people`, undefined],
        ['POST', `/api/knowledge/${item.id}/teams/meeting`, {}],
        [
          'POST',
          `/api/knowledge/${item.id}/teams/connect`,
          { url: 'https://teams.microsoft.com/meet/123456789' },
        ],
        ['POST', `/api/knowledge/${item.id}/teams/check`, {}],
        ['DELETE', `/api/knowledge/${item.id}/teams`, undefined],
        ['GET', '/api/public/meetings/AAAAAAAAAAAAAAAAAAAAAA', undefined],
        ['GET', '/api/public/meetings/AAAAAAAAAAAAAAAAAAAAAA/invite.ics', undefined],
      ] as const) {
        const res = await call(method, path, admin.cookie, body, off);
        expect(res.statusCode, `${method} ${path}`).toBe(404);
      }
      expect(off.deps.teams).toBeNull();
      const res = await call('GET', `/api/knowledge/${item.id}`, admin.cookie, undefined, off);
      expect(res.json().meetingDetail).toMatchObject({ transcriptAdminsOnly: false });
    });
  });

  describe('who may use it', () => {
    it('admins see the Teams block; a client of the group and a ziadatel get 404', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const client = await member(group.id);
      const ziadatel = await member(group.id, 'ziadatel');
      // A client's own meeting: they edit it, yet Teams stays an admin action.
      const own = await newMeeting(client.cookie, group.id);
      const state = await call('GET', `/api/knowledge/${own.id}/teams`, admin.cookie);
      expect(state.statusCode, state.body).toBe(200);
      expect(TeamsMeetingStateSchema.parse(state.json())).toEqual({ link: null });
      for (const person of [client, ziadatel]) {
        for (const [method, path, body] of [
          ['GET', `/api/knowledge/${own.id}/teams`, undefined],
          ['GET', `/api/knowledge/${own.id}/teams/people`, undefined],
          ['POST', `/api/knowledge/${own.id}/teams/meeting`, {}],
          [
            'POST',
            `/api/knowledge/${own.id}/teams/connect`,
            { url: classicLink('x', TENANT, randomUUID()) },
          ],
          ['POST', `/api/knowledge/${own.id}/teams/check`, {}],
          ['DELETE', `/api/knowledge/${own.id}/teams`, undefined],
        ] as const) {
          const res = await call(method, path, person.cookie, body);
          expect(res.statusCode, `${method} ${path}`).toBe(404);
        }
      }
      expect(graph.calls).toHaveLength(0);
      expect((await call('GET', `/api/knowledge/${own.id}/teams`)).statusCode).toBe(401);
    });

    it('a ziadatel cannot share a transcript either (404), a client gets 403', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const client = await member(group.id);
      const ziadatel = await member(group.id, 'ziadatel');
      const item = await newMeeting(admin.cookie, group.id);
      const share = (cookie: string) =>
        call('POST', `/api/knowledge/${item.id}/meeting/share-transcript`, cookie);
      expect((await share(ziadatel.cookie)).statusCode).toBe(404);
      expect((await share(client.cookie)).statusCode).toBe(403);
      expect((await share(admin.cookie)).statusCode).toBe(204);
    });

    it('an item that is no meeting, or unknown, is 404', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const note = await call('POST', `/api/groups/${group.id}/knowledge`, admin.cookie, {
        type: 'note',
        title: 'N',
        body: '',
      });
      expect(
        (await call('GET', `/api/knowledge/${note.json().id}/teams`, admin.cookie)).statusCode,
      ).toBe(404);
      expect(
        (await call('GET', `/api/knowledge/${randomUUID()}/teams`, admin.cookie)).statusCode,
      ).toBe(404);
    });
  });

  describe('Create Teams meeting', () => {
    it('makes a calendar event with only the picked invitees and the recording notice', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const client = await member(group.id);
      await member(group.id); // offered, not picked
      const item = await newMeeting(admin.cookie, group.id);

      const people = await call('GET', `/api/knowledge/${item.id}/teams/people`, admin.cookie);
      const options = TeamsInviteeOptionListSchema.parse(people.json());
      expect(options.map((o) => o.email)).toContain(client.email);
      expect(options).toHaveLength(2); // the clients; no admin manages this group

      const res = await createTeams(admin.cookie, item.id, {
        durationMinutes: 45,
        attendees: [
          { email: client.email, name: 'Klient Firmy' },
          { email: 'Guest@Partner.example' },
        ],
      });
      expect(res.statusCode, res.body).toBe(201);
      const state = TeamsMeetingStateSchema.parse(res.json());
      expect(state.link).toMatchObject({
        origin: 'help',
        durationMinutes: 45,
        recordAutomatically: true,
        transcriptState: 'waiting',
        organizerName: 'Jana Admin',
      });
      expect(state.link!.invitationUrl).toMatch(/^http:\/\/localhost:3000\/m\/[A-Za-z0-9_-]{22}$/);

      const event = graph.events.at(-1)!;
      expect(event.organizerId).toBe(admin.ms!.id);
      const body = event.body as {
        subject: string;
        isOnlineMeeting: boolean;
        onlineMeetingProvider: string;
        attendees: { emailAddress: { address: string } }[];
        body: { content: string };
        start: { dateTime: string; timeZone: string };
        end: { dateTime: string };
      };
      expect(body).toMatchObject({
        subject: 'Kickoff Mesto X',
        isOnlineMeeting: true,
        onlineMeetingProvider: 'teamsForBusiness',
      });
      expect(body.attendees.map((a) => a.emailAddress.address)).toEqual([
        client.email,
        'guest@partner.example',
      ]);
      expect(body.body.content).toContain(SK_NOTICE);
      expect(body.body.content).toContain(state.link!.invitationUrl!);
      // Nothing of the record's notes goes to Microsoft.
      expect(JSON.stringify(body)).not.toContain('rozpočet');
      expect(Date.parse(`${body.end.dateTime}Z`) - Date.parse(`${body.start.dateTime}Z`)).toBe(
        45 * MIN,
      );

      // Automatic recording on the event's online meeting (owner answer 2).
      const patch = graph.callsTo('/onlineMeetings/', 'PATCH');
      expect(patch).toHaveLength(1);
      expect(patch[0]!.body).toEqual({ recordAutomatically: true, allowTranscription: true });

      // The join URL is the call's link now; the item stays the knowledge meeting.
      const detail = await getItem(admin.cookie, item.id);
      expect(detail.type).toBe('meeting');
      expect(detail.meetingDetail!.meetingUrl).toBe(state.link!.joinUrl);
      const row = await linkRow(item.id);
      expect(row).toMatchObject({ eventId: event.id, icalUid: event.iCalUId, recordApplied: true });
      expect(row!.onlineMeetingId).toMatch(/^MSo/);
      // The token is not stored, only its hash.
      expect(JSON.stringify(row)).not.toContain(state.link!.invitationUrl!.split('/m/')[1]);

      // A second create is refused.
      expect((await createTeams(admin.cookie, item.id)).json()).toEqual({ error: 'teams_linked' });
    });

    it('without automatic recording: no PATCH and the softer notice', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await newMeeting(admin.cookie, group.id);
      const res = await createTeams(admin.cookie, item.id, { recordAutomatically: false });
      expect(res.statusCode, res.body).toBe(201);
      expect(graph.callsTo('/onlineMeetings/', 'PATCH')).toHaveLength(0);
      const content = (graph.events.at(-1)!.body as { body: { content: string } }).body.content;
      expect(content).toContain(SK_MAY_NOTICE);
      expect(content).not.toContain(SK_NOTICE);
      expect(graph.events.at(-1)!.body).toMatchObject({ attendees: [] });
    });

    it('an admin outside the organizers group or without a Microsoft account gets a clear error', async () => {
      const group = await newGroup();
      for (const kind of ['outside', 'none'] as const) {
        const admin = await newAdmin(kind);
        const item = await newMeeting(admin.cookie, group.id);
        const res = await createTeams(admin.cookie, item.id);
        expect(res.statusCode, kind).toBe(403);
        expect(res.json()).toEqual({ error: 'teams_not_organizer' });
        expect(await linkRow(item.id)).toBeUndefined();
      }
    });

    it('validates the body', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await newMeeting(admin.cookie, group.id);
      for (const body of [
        { durationMinutes: 5 },
        { attendees: [{ email: 'not-an-email' }] },
        { attendees: Array.from({ length: 101 }, (_, i) => ({ email: `p${i}@e.sk` })) },
        { extra: true },
      ]) {
        expect((await createTeams(admin.cookie, item.id, body)).statusCode).toBe(400);
      }
    });
  });

  describe('Connect Teams link', () => {
    it('resolves a pasted link through a known organizer (another Help admin)', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const colleague = await newAdmin();
      const made = graph.addMeeting(colleague.ms!);
      const item = await newMeeting(admin.cookie, group.id);
      const res = await connect(admin.cookie, item.id, made.joinWebUrl);
      expect(res.statusCode, res.body).toBe(200);
      expect(TeamsMeetingStateSchema.parse(res.json()).link).toMatchObject({
        origin: 'linked',
        durationMinutes: 45,
        invitationUrl: null,
      });
      const row = await linkRow(item.id);
      expect(row).toMatchObject({
        onlineMeetingId: made.id,
        organizerEntraId: colleague.ms!.id,
        organizerUserId: colleague.id,
        calendarTokenHash: null,
      });
      expect((await getItem(admin.cookie, item.id)).meetingDetail!.meetingUrl).toBe(
        made.joinWebUrl,
      );
      // Only the hinted organizer was asked.
      const lookups = graph.callsTo('/onlineMeetings?', 'GET');
      expect(lookups).toHaveLength(1);
      expect(lookups[0]!.url).toContain(colleague.ms!.id);
    });

    it('resolves a short /meet/ link by its meeting ID', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const made = graph.addMeeting(admin.ms!);
      const item = await newMeeting(admin.cookie, group.id);
      const res = await connect(
        admin.cookie,
        item.id,
        `https://teams.microsoft.com/meet/${made.joinMeetingId}?p=abc`,
      );
      expect(res.statusCode, res.body).toBe(200);
      expect((await linkRow(item.id))!.onlineMeetingId).toBe(made.id);
    });

    it('refuses a link of another tenant, of personal Teams or of an unknown organizer', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await newMeeting(admin.cookie, group.id);
      const stranger = graph.addUser(newEmail(), 'Not In Help'); // in the tenant, no Help admin
      const strangers = graph.addMeeting(stranger);
      const cases: [string, number, string][] = [
        [classicLink('a', OTHER_TENANT, admin.ms!.id), 400, 'teams_outside_tenant'],
        ['https://teams.live.com/meet/9387465012', 400, 'teams_outside_tenant'],
        [strangers.joinWebUrl, 400, 'teams_unknown_organizer'],
        [classicLink('gone', TENANT, admin.ms!.id), 404, 'teams_meeting_not_found'],
        ['https://zoom.us/j/123456789', 400, 'teams_invalid_link'],
      ];
      for (const [url, status, error] of cases) {
        const res = await connect(admin.cookie, item.id, url);
        expect(res.statusCode, url).toBe(status);
        expect(res.json()).toEqual({ error });
      }
      expect(await linkRow(item.id)).toBeUndefined();
    });

    it('one Teams meeting connects to one item only (409 teams_meeting_linked)', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const made = graph.addMeeting(admin.ms!);
      const first = await newMeeting(admin.cookie, group.id);
      const second = await newMeeting(admin.cookie, group.id);
      expect((await connect(admin.cookie, first.id, made.joinWebUrl)).statusCode).toBe(200);
      const again = await connect(admin.cookie, second.id, made.joinWebUrl);
      expect(again.statusCode, again.body).toBe(409);
      expect(again.json()).toEqual({ error: 'teams_meeting_linked' });
      expect(await linkRow(second.id)).toBeUndefined();

      // Nor a meeting Help made for another item.
      const third = await newMeeting(admin.cookie, group.id);
      const helpMade = await createTeams(admin.cookie, third.id);
      expect(helpMade.statusCode, helpMade.body).toBe(201);
      const joinUrl = TeamsMeetingStateSchema.parse(helpMade.json()).link!.joinUrl;
      expect((await connect(admin.cookie, second.id, joinUrl)).json()).toEqual({
        error: 'teams_meeting_linked',
      });
    });

    it('refuses a meeting whose organizer Graph does not state', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const made = graph.addMeeting(admin.ms!, { omitOrganizer: true });
      const item = await newMeeting(admin.cookie, group.id);
      const res = await connect(
        admin.cookie,
        item.id,
        `https://teams.microsoft.com/meet/${made.joinMeetingId}`,
      );
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json()).toEqual({ error: 'teams_unknown_organizer' });
      expect(await linkRow(item.id)).toBeUndefined();
    });

    it('refuses a meeting Graph says is organised in another tenant', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const made = graph.addMeeting(admin.ms!, { tenantId: OTHER_TENANT });
      const item = await newMeeting(admin.cookie, group.id);
      const res = await connect(
        admin.cookie,
        item.id,
        `https://teams.microsoft.com/meet/${made.joinMeetingId}`,
      );
      expect(res.json()).toEqual({ error: 'teams_outside_tenant' });
    });
  });

  describe('transcript import', () => {
    /** A connected meeting that started `startedMinutesAgo` ago, lasting 60 minutes. */
    async function connectedMeeting(
      startedMinutesAgo: number,
      fields: Record<string, unknown> = {},
      byClient = false,
    ) {
      const group = await newGroup();
      const admin = await newAdmin();
      const client = await member(group.id);
      const startsAt = new Date(Date.now() - startedMinutesAgo * MIN);
      const made = graph.addMeeting(admin.ms!, {
        startDateTime: startsAt.toISOString(),
        endDateTime: new Date(startsAt.getTime() + 60 * MIN).toISOString(),
      });
      const item = await newMeeting(byClient ? client.cookie : admin.cookie, group.id, {
        startsAt: startsAt.toISOString(),
        ...fields,
      });
      const res = await connect(admin.cookie, item.id, made.joinWebUrl);
      expect(res.statusCode, res.body).toBe(200);
      return { group, admin, client, item, made, startsAt };
    }
    const contentFetches = () => graph.callsTo('/content').length;

    it('polls on schedule, imports once, holds it for admins until shared', async () => {
      // The client's own meeting (they edit it), connected by an admin.
      const { admin, client, item, made, startsAt, group } = await connectedMeeting(70, {}, true);
      const row = (await linkRow(item.id))!;
      expect(row.nextPollAt!.getTime()).toBeGreaterThan(Date.now());
      // Not due yet: nothing happens to it.
      await pollDueMeetings(graphDeps(), new Date());
      expect(graph.callsTo(made.id)).toHaveLength(0);

      graph.addTranscript(
        made.id,
        new Date(startsAt.getTime() + 2 * MIN),
        vtt([
          ['Jana Admin', 'Dobrý deň.'],
          ['Klient Firmy', 'Ahoj, začnime rozpočtom.'],
        ]),
      );
      // The next week's occurrence of the same series is not this record's.
      graph.addTranscript(
        made.id,
        new Date(startsAt.getTime() + 7 * 24 * 60 * MIN),
        vtt([['X', 'Inny tyzden']]),
      );
      const due = new Date(row.nextPollAt!.getTime() + 1000);
      await pollDueMeetings(graphDeps(), due);
      expect(contentFetches()).toBe(1);

      const adminView = (await getItem(admin.cookie, item.id)).meetingDetail!;
      expect(adminView).toMatchObject({
        transcript: 'Jana Admin: Dobrý deň.\nKlient Firmy: Ahoj, začnime rozpočtom.',
        transcriptSource: 'teams',
        transcriptAdminsOnly: true,
      });
      const clientView = (await getItem(client.cookie, item.id)).meetingDetail!;
      expect(clientView).toMatchObject({
        transcript: '',
        transcriptSource: null,
        summary: null,
        transcriptAdminsOnly: false,
      });
      expect(JSON.stringify(await getItem(client.cookie, item.id))).not.toContain('rozpočtom');
      expect((await linkRow(item.id))!.transcriptState).toBe('imported');

      // The same set again: no download (idempotent).
      const later = new Date((await linkRow(item.id))!.nextPollAt!.getTime() + 1000);
      await pollDueMeetings(graphDeps(), later);
      expect(contentFetches()).toBe(1);

      // A client's edit of their view (empty transcript) does not wipe the hidden one.
      const edit = await call('PATCH', `/api/knowledge/${item.id}`, client.cookie, {
        updatedAt: (await getItem(client.cookie, item.id)).updatedAt,
        meeting: { transcript: '' },
      });
      expect(edit.statusCode, edit.body).toBe(200);
      const stored = await test.deps.db
        .select()
        .from(knowledgeMeetings)
        .where(eq(knowledgeMeetings.itemId, item.id));
      expect(stored[0]!.transcript).toContain('rozpočtom');

      // An admin's summary stays out of the client's search while held.
      const word = `slovo${randomUUID().slice(0, 8)}`;
      const withSummary = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
        updatedAt: (await getItem(admin.cookie, item.id)).updatedAt,
        meeting: {
          summary: {
            summary: word,
            decisions: [],
            actionItems: [],
            openQuestions: [],
            language: 'sk',
          },
        },
      });
      expect(withSummary.statusCode, withSummary.body).toBe(200);
      const search = async () =>
        KnowledgePageSchema.parse(
          (await call('GET', `/api/groups/${group.id}/knowledge?q=${word}`, client.cookie)).json(),
        ).items.map((i) => i.id);
      expect(await search()).toEqual([]);
      expect((await getItem(client.cookie, item.id)).meetingDetail!.summary).toBeNull();

      // Shared: the client sees it all, and search finds the summary.
      expect(
        (await call('POST', `/api/knowledge/${item.id}/meeting/share-transcript`, admin.cookie))
          .statusCode,
      ).toBe(204);
      const shared = (await getItem(client.cookie, item.id)).meetingDetail!;
      expect(shared.transcript).toContain('rozpočtom');
      expect(shared.summary?.summary).toBe(word);
      expect(await search()).toEqual([item.id]);
    });

    it('a transcript restarted in the call is joined; a manual one is kept until replaced', async () => {
      const { admin, item, made, startsAt } = await connectedMeeting(80, {
        transcript: 'Ručný zápis',
      });
      graph.addTranscript(
        made.id,
        new Date(startsAt.getTime() + 30 * MIN),
        vtt([['B', 'Druhá časť']]),
      );
      graph.addTranscript(
        made.id,
        new Date(startsAt.getTime() + 5 * MIN),
        vtt([['A', 'Prvá časť']]),
      );
      const check = (replace: boolean) =>
        call('POST', `/api/knowledge/${item.id}/teams/check`, admin.cookie, { replace });
      const kept = await check(false);
      expect(kept.statusCode, kept.body).toBe(200);
      expect(kept.json().link.transcriptState).toBe('available');
      expect((await getItem(admin.cookie, item.id)).meetingDetail!.transcript).toBe('Ručný zápis');
      const replaced = await check(true);
      expect(replaced.json().link.transcriptState).toBe('imported');
      expect((await getItem(admin.cookie, item.id)).meetingDetail).toMatchObject({
        transcript: 'A: Prvá časť\n\nB: Druhá časť',
        transcriptSource: 'teams',
        transcriptAdminsOnly: true,
      });
    });

    it('shows Graph errors as codes and ends as failed after 3 days', async () => {
      const { admin, item } = await connectedMeeting(65);
      graph.transcriptsDisabled = true;
      try {
        const res = await call('POST', `/api/knowledge/${item.id}/teams/check`, admin.cookie, {});
        expect(res.json().link).toMatchObject({
          transcriptState: 'waiting',
          lastError: 'GraphAccessToTranscriptsDisabled',
        });
        const late = new Date(Date.now() + 4 * 24 * 60 * MIN);
        await test.deps.db
          .update(teamsMeetingLinks)
          .set({ nextPollAt: new Date(late.getTime() - 1000) })
          .where(eq(teamsMeetingLinks.itemId, item.id));
        await pollDueMeetings(graphDeps(), late);
        expect(await linkRow(item.id)).toMatchObject({
          transcriptState: 'failed',
          nextPollAt: null,
        });
      } finally {
        graph.transcriptsDisabled = false;
      }
    });

    it('no transcript at all ends as none; disconnect stops it', async () => {
      const { admin, item } = await connectedMeeting(65);
      const late = new Date(Date.now() + 4 * 24 * 60 * MIN);
      await test.deps.db
        .update(teamsMeetingLinks)
        .set({ nextPollAt: new Date(late.getTime() - 1000) })
        .where(eq(teamsMeetingLinks.itemId, item.id));
      await pollDueMeetings(graphDeps(), late);
      expect(await linkRow(item.id)).toMatchObject({ transcriptState: 'none', nextPollAt: null });
      expect(
        (await call('DELETE', `/api/knowledge/${item.id}/teams`, admin.cookie)).statusCode,
      ).toBe(204);
      expect(await linkRow(item.id)).toBeUndefined();
      expect((await call('GET', `/api/knowledge/${item.id}/teams`, admin.cookie)).json()).toEqual({
        link: null,
      });
    });

    const summaryPatch = (word: string) => ({
      summary: { summary: word, decisions: [], actionItems: [], openQuestions: [], language: 'sk' },
    });

    it('a held summary shows no summary badge to a client: list, search, socket', async () => {
      const { admin, client, item, made, startsAt, group } = await connectedMeeting(70);
      graph.addTranscript(made.id, new Date(startsAt.getTime() + 2 * MIN), vtt([['A', 'Ahoj']]));
      const check = await call('POST', `/api/knowledge/${item.id}/teams/check`, admin.cookie, {});
      expect(check.json().link.transcriptState).toBe('imported');
      const adminRows = await knowledgeRows(admin.cookie, group.id);
      const clientRows = await knowledgeRows(client.cookie);

      const edit = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
        updatedAt: (await getItem(admin.cookie, item.id)).updatedAt,
        meeting: summaryPatch('Zhrnutie'),
      });
      expect(edit.statusCode, edit.body).toBe(200);
      const badge = (rows: KnowledgeItemEvent['item'][]) =>
        rows.filter((r) => r.id === item.id).at(-1)?.meeting?.hasSummary;
      await until(() => badge(adminRows) !== undefined && badge(clientRows) !== undefined);
      expect(badge(adminRows)).toBe(true);
      expect(badge(clientRows)).toBe(false);

      const listed = async (cookie: string, q = '') => {
        const res = await call('GET', `/api/groups/${group.id}/knowledge?q=${q}`, cookie);
        expect(res.statusCode, res.body).toBe(200);
        return KnowledgePageSchema.parse(res.json()).items.find((i) => i.id === item.id)?.meeting;
      };
      expect((await listed(admin.cookie))?.hasSummary).toBe(true);
      expect((await listed(client.cookie))?.hasSummary).toBe(false);
      expect((await listed(client.cookie, 'Kickoff'))?.hasSummary).toBe(false);

      // Shared: the badge reaches the client too.
      const before = clientRows.length;
      expect(
        (await call('POST', `/api/knowledge/${item.id}/meeting/share-transcript`, admin.cookie))
          .statusCode,
      ).toBe(204);
      await until(() => clientRows.length > before);
      expect(badge(clientRows)).toBe(true);
      expect((await listed(client.cookie))?.hasSummary).toBe(true);
    });

    it('a failing network still moves the poll on, ends as failed and is a 502', async () => {
      const { admin, item, made } = await connectedMeeting(65);
      const now = new Date();
      await test.deps.db
        .update(teamsMeetingLinks)
        .set({ nextPollAt: new Date(now.getTime() - 1000) })
        .where(eq(teamsMeetingLinks.itemId, item.id));
      graph.networkDown = true;
      await pollDueMeetings(graphDeps(), now);
      const row = (await linkRow(item.id))!;
      expect(row.lastError).toBe('network');
      expect(row.transcriptState).toBe('waiting');
      // Not first in line any more: the next run looks at the others first.
      expect(row.nextPollAt!.getTime()).toBeGreaterThan(now.getTime());

      const late = new Date(Date.now() + 4 * 24 * 60 * MIN);
      await test.deps.db
        .update(teamsMeetingLinks)
        .set({ nextPollAt: new Date(late.getTime() - 1000) })
        .where(eq(teamsMeetingLinks.itemId, item.id));
      await pollDueMeetings(graphDeps(), late);
      expect(await linkRow(item.id)).toMatchObject({ transcriptState: 'failed', nextPollAt: null });

      // The admin's actions answer 502 teams_unavailable, never 500.
      const group = await newGroup();
      const other = await newMeeting(admin.cookie, group.id);
      const connected = await connect(admin.cookie, other.id, made.joinWebUrl);
      expect(connected.statusCode, connected.body).toBe(502);
      expect(connected.json()).toEqual({ error: 'teams_unavailable' });
      const fresh = await newAdmin();
      const created = await createTeams(fresh.cookie, other.id);
      expect(created.statusCode, created.body).toBe(502);
      expect(created.json()).toEqual({ error: 'teams_unavailable' });
    });

    it('a client moving the start onto another occurrence does not import that one', async () => {
      const { admin, client, item, made, startsAt } = await connectedMeeting(70, {}, true);
      const nextWeek = new Date(startsAt.getTime() + 7 * 24 * 60 * MIN);
      const moved = await call('PATCH', `/api/knowledge/${item.id}`, client.cookie, {
        updatedAt: (await getItem(client.cookie, item.id)).updatedAt,
        meeting: { startsAt: nextWeek.toISOString() },
      });
      expect(moved.statusCode, moved.body).toBe(200);
      graph.addTranscript(
        made.id,
        new Date(nextWeek.getTime() + 2 * MIN),
        vtt([['X', 'Iná porada']]),
      );
      const res = await call('POST', `/api/knowledge/${item.id}/teams/check`, admin.cookie, {});
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().link.transcriptState).toBe('waiting');
      expect(contentFetches()).toBe(0);
      expect((await getItem(admin.cookie, item.id)).meetingDetail!.transcript).toBe('');
      // The window stays the one stored at connect time.
      expect((await linkRow(item.id))!.startsAt.getTime()).toBe(startsAt.getTime());
    });

    it('deleting the meeting item deletes its Teams row', async () => {
      const { admin, item } = await connectedMeeting(65);
      expect((await call('DELETE', `/api/knowledge/${item.id}`, admin.cookie)).statusCode).toBe(
        204,
      );
      expect(await linkRow(item.id)).toBeUndefined();
    });
  });

  describe('public add-to-calendar page', () => {
    async function helpMeeting(recordAutomatically = true) {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await newMeeting(admin.cookie, group.id, { transcript: 'Tajný prepis' });
      const res = await createTeams(admin.cookie, item.id, { recordAutomatically });
      expect(res.statusCode, res.body).toBe(201);
      const url = TeamsMeetingStateSchema.parse(res.json()).link!.invitationUrl!;
      return { admin, item, token: url.split('/m/')[1]!, group };
    }

    it('shows only the title, the time, the join link and the recording flag', async () => {
      const { item, token, group } = await helpMeeting();
      const res = await call('GET', `/api/public/meetings/${token}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex');
      const body = res.json();
      expect(Object.keys(body).sort()).toEqual([
        'endsAt',
        'joinUrl',
        'recorded',
        'startsAt',
        'title',
      ]);
      expect(PublicMeetingSchema.parse(body)).toMatchObject({
        title: 'Kickoff Mesto X',
        recorded: true,
      });
      expect(Date.parse(body.endsAt) - Date.parse(body.startsAt)).toBe(60 * MIN);
      const text = res.body;
      for (const secret of ['Tajný', 'rozpočet', group.name, item.id, group.id, 'Jana']) {
        expect(text).not.toContain(secret);
      }
    });

    it('serves an .ics with the event iCalUId and the notice in the asked language', async () => {
      const { item, token } = await helpMeeting(false);
      const row = (await linkRow(item.id))!;
      const res = await call('GET', `/api/public/meetings/${token}/invite.ics?lang=en`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      const ics = res.body.replace(/\r\n /g, '');
      expect(ics).toContain(`UID:${row.icalUid}`);
      expect(ics).toContain('LOCATION:Microsoft Teams');
      expect(ics).toContain('This call may be recorded and transcribed.');
      expect(ics).not.toContain('VALARM');
      expect(ics).not.toContain('Tajný');
    });

    it('a wrong, malformed or revoked token is 404', async () => {
      const { admin, item, token } = await helpMeeting();
      const forged = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
      for (const bad of [forged, 'short', `${token}x`, '..%2F..%2Fetc']) {
        expect((await call('GET', `/api/public/meetings/${bad}`)).statusCode, bad).toBe(404);
      }
      expect(
        (await call('DELETE', `/api/knowledge/${item.id}/teams`, admin.cookie)).statusCode,
      ).toBe(204);
      expect((await call('GET', `/api/public/meetings/${token}`)).statusCode).toBe(404);
      expect((await call('GET', `/api/public/meetings/${token}/invite.ics`)).statusCode).toBe(404);
    });
  });

  it('a group manager is offered as an invitee', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const manager = await newAdmin();
    await addManager(test.deps.db, group.id, manager.id);
    const item = await newMeeting(admin.cookie, group.id);
    const res = await call('GET', `/api/knowledge/${item.id}/teams/people`, admin.cookie);
    const options = TeamsInviteeOptionListSchema.parse(res.json());
    expect(options.find((o) => o.id === manager.id)).toMatchObject({
      isAdmin: true,
      email: manager.email,
    });
    expect(options.find((o) => o.id === admin.id)).toBeUndefined();
  });
});
