import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import {
  KnowledgeItemDtoSchema,
  KnowledgePageSchema,
  occurrenceStart,
  type KnowledgeItemDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMember, createGroup } from '../groups/service.js';
import { addMembership } from '../groups/memberships.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { materialiseDueSeries } from './meeting-series.js';
import { knowledgeMeetings, knowledgeMeetingSeries } from './schema.js';
import { auditRowsOfMany } from '../audit/test-helpers.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; cookie: string };

const DAY = 86_400_000;
const TZ = 'Europe/Bratislava';
const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;
/** A start `days` ahead at a whole minute. */
const inDays = (days: number) => new Date(Math.floor((Date.now() + days * DAY) / 60_000) * 60_000);

describe('recurring calls (ADR 0049)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie?: string,
    payload?: unknown,
  ) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  async function newAdmin(): Promise<Person> {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name: 'Series Admin' });
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }

  async function clientIn(groupId: string, role: 'client' | 'ziadatel' = 'client') {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'Series Client', role: 'client', emailVerified: true });
    if (role === 'client') await addMember(test.deps.db, groupId, id);
    else await addMembership(test.deps.db, id, groupId, 'ziadatel');
    return { id, cookie: await loginAs(test.app, email) };
  }

  const newGroup = () => createGroup(test.deps.db, { name: 'Firma', egrantUrl: newUrl() });

  const draft = (start: Date, repeat: Record<string, unknown> | null, over = {}) => ({
    type: 'meeting',
    title: 'Weekly sync',
    body: 'Agenda',
    meeting: {
      startsAt: start.toISOString(),
      meetingUrl: 'https://zoom.example.com/j/1',
      repeat: repeat === null ? null : { timeZone: TZ, ...repeat },
    },
    ...over,
  });

  async function create(cookie: string, groupId: string, body: unknown): Promise<KnowledgeItemDto> {
    const res = await call('POST', `/api/groups/${groupId}/knowledge`, cookie, body);
    expect(res.statusCode, res.body).toBe(201);
    return KnowledgeItemDtoSchema.parse(res.json());
  }

  const getItem = async (cookie: string, id: string) => {
    const res = await call('GET', `/api/knowledge/${id}`, cookie);
    expect(res.statusCode, res.body).toBe(200);
    return KnowledgeItemDtoSchema.parse(res.json());
  };

  /** The calls of a series, in order. */
  const occurrences = (seriesId: string) =>
    test.deps.db
      .select({
        id: knowledgeMeetings.itemId,
        index: knowledgeMeetings.seriesIndex,
        startsAt: knowledgeMeetings.startsAt,
        transcript: knowledgeMeetings.transcript,
      })
      .from(knowledgeMeetings)
      .where(eq(knowledgeMeetings.seriesId, seriesId))
      .orderBy(asc(knowledgeMeetings.seriesIndex));

  const seriesRow = async (id: string) =>
    (
      await test.deps.db
        .select()
        .from(knowledgeMeetingSeries)
        .where(eq(knowledgeMeetingSeries.id, id))
    )[0]!;

  describe('creating a series', () => {
    it('a weekly call with a count creates all its calls, a week apart', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const start = inDays(1);
      const item = await create(
        admin.cookie,
        group.id,
        draft(start, { frequency: 'weekly', count: 3 }),
      );
      const series = item.meetingDetail!.series!;
      expect(series).toMatchObject({
        frequency: 'weekly',
        timeZone: TZ,
        count: 3,
        until: null,
        index: 0,
        followingCount: 2,
        ended: true,
      });
      const calls = await occurrences(series.id);
      expect(calls.map((c) => c.index)).toEqual([0, 1, 2]);
      const rule = {
        frequency: 'weekly' as const,
        timeZone: TZ,
        anchorStartsAt: start,
        anchorIndex: 0,
      };
      expect(calls.map((c) => c.startsAt.toISOString())).toEqual(
        [0, 1, 2].map((i) => occurrenceStart(rule, i).toISOString()),
      );
      // Each call is an item of its own, in the list, marked as recurring.
      const list = await call(
        'GET',
        `/api/groups/${group.id}/knowledge?type=meeting`,
        admin.cookie,
      );
      const rows = KnowledgePageSchema.parse(list.json()).items;
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.meeting?.recurring === true && r.title === 'Weekly sync')).toBe(
        true,
      );
      const second = await getItem(admin.cookie, calls[1]!.id);
      expect(second.meetingDetail!.meetingUrl).toBe('https://zoom.example.com/j/1');
      expect(second.meetingDetail!.series).toMatchObject({ index: 1, followingCount: 1 });
    });

    it('an open series is created 60 days ahead; the job keeps the window filled', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(admin.cookie, group.id, draft(inDays(1), { frequency: 'weekly' }));
      const id = item.meetingDetail!.series!.id;
      expect(item.meetingDetail!.series!.ended).toBe(false);
      // Days 1, 8, …, 57: nine calls inside the 60 days.
      expect(await occurrences(id)).toHaveLength(9);
      expect((await seriesRow(id)).nextIndex).toBe(9);

      await materialiseDueSeries({ db: test.deps.db }, new Date(Date.now() + 30 * DAY));
      const later = await occurrences(id);
      expect(later.map((c) => c.index)).toEqual([...Array(13).keys()]);
      // Running again changes nothing.
      await materialiseDueSeries({ db: test.deps.db }, new Date(Date.now() + 30 * DAY));
      expect(await occurrences(id)).toHaveLength(13);
    });

    it('monthly on the same weekday, ending on a day', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const start = inDays(2);
      const item = await create(
        admin.cookie,
        group.id,
        draft(start, {
          frequency: 'monthly_weekday',
          until: new Date(start.getTime() + 100 * DAY).toISOString().slice(0, 10),
        }),
      );
      const calls = await occurrences(item.meetingDetail!.series!.id);
      const rule = {
        frequency: 'monthly_weekday' as const,
        timeZone: TZ,
        anchorStartsAt: start,
        anchorIndex: 0,
      };
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls[1]!.startsAt.toISOString()).toBe(occurrenceStart(rule, 1).toISOString());
    });

    it('stops at the end date', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const start = inDays(1);
      const until = new Date(start.getTime() + 15 * DAY).toISOString().slice(0, 10);
      const item = await create(
        admin.cookie,
        group.id,
        draft(start, { frequency: 'weekly', until }),
      );
      expect(await occurrences(item.meetingDetail!.series!.id)).toHaveLength(3);
      expect(item.meetingDetail!.series!.ended).toBe(true);
    });

    it('gives every call its own reminder at the same offset', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const client = await clientIn(group.id);
      const start = inDays(1);
      const at = new Date(start.getTime() - 15 * 60_000).toISOString();
      const item = await create(
        admin.cookie,
        group.id,
        draft(
          start,
          { frequency: 'biweekly', count: 2 },
          { reminder: { times: [{ at }], recipientIds: [client.id] } },
        ),
      );
      const calls = await occurrences(item.meetingDetail!.series!.id);
      const second = await getItem(admin.cookie, calls[1]!.id);
      expect(second.reminder!.times.map((t) => t.at)).toEqual([
        new Date(calls[1]!.startsAt.getTime() - 15 * 60_000).toISOString(),
      ]);
      expect(second.reminder!.recipients.map((r) => r.user.id)).toEqual(
        expect.arrayContaining([admin.id, client.id]),
      );
    });

    it('refuses a bad rule: too far in the past, an end before the start, on a note', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const post = (body: unknown) =>
        call('POST', `/api/groups/${group.id}/knowledge`, admin.cookie, body);
      expect((await post(draft(inDays(-8), { frequency: 'weekly' }))).statusCode).toBe(400);
      expect(
        (await post(draft(inDays(5), { frequency: 'weekly', until: '2020-01-01' }))).statusCode,
      ).toBe(400);
      expect(
        (await post(draft(inDays(5), { frequency: 'weekly', until: '2099-01-01' }))).statusCode,
      ).toBe(400);
      expect((await post(draft(inDays(5), { frequency: 'daily' }))).statusCode).toBe(400);
    });
  });

  describe('editing', () => {
    it('"this call" changes only that call', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(
        admin.cookie,
        group.id,
        draft(inDays(1), { frequency: 'weekly', count: 3 }),
      );
      const calls = await occurrences(item.meetingDetail!.series!.id);
      const second = await getItem(admin.cookie, calls[1]!.id);
      const res = await call('PATCH', `/api/knowledge/${second.id}`, admin.cookie, {
        title: 'Moved sync',
        meeting: { startsAt: new Date(calls[1]!.startsAt.getTime() + 3_600_000).toISOString() },
        updatedAt: second.updatedAt,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((await getItem(admin.cookie, calls[2]!.id)).title).toBe('Weekly sync');
      expect((await getItem(admin.cookie, calls[0]!.id)).title).toBe('Weekly sync');
      expect((await occurrences(item.meetingDetail!.series!.id))[2]!.startsAt).toEqual(
        calls[2]!.startsAt,
      );
    });

    it('"this and following" moves and renames the later calls and the calls still to come', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(admin.cookie, group.id, draft(inDays(1), { frequency: 'weekly' }));
      const seriesId = item.meetingDetail!.series!.id;
      const calls = await occurrences(seriesId);
      // A transcript on a later call stays its own.
      const fourth = await getItem(admin.cookie, calls[3]!.id);
      await call('PATCH', `/api/knowledge/${fourth.id}`, admin.cookie, {
        meeting: { transcript: 'Only the fourth call' },
        updatedAt: fourth.updatedAt,
      });
      const second = await getItem(admin.cookie, calls[1]!.id);
      const moved = new Date(calls[1]!.startsAt.getTime() + 26 * 3_600_000); // a day and 2 h later
      const res = await call('PATCH', `/api/knowledge/${second.id}`, admin.cookie, {
        title: 'Tuesday sync',
        meeting: { startsAt: moved.toISOString(), meetingUrl: 'https://zoom.example.com/j/2' },
        seriesScope: 'following',
        updatedAt: second.updatedAt,
      });
      expect(res.statusCode, res.body).toBe(200);
      const after = await occurrences(seriesId);
      expect(after[0]!.startsAt).toEqual(calls[0]!.startsAt);
      expect((await getItem(admin.cookie, after[0]!.id)).title).toBe('Weekly sync');
      const rule = {
        frequency: 'weekly' as const,
        timeZone: TZ,
        anchorStartsAt: moved,
        anchorIndex: 1,
      };
      for (const c of after.slice(1)) {
        expect(c.startsAt.toISOString()).toBe(occurrenceStart(rule, c.index!).toISOString());
        const detail = await getItem(admin.cookie, c.id);
        expect(detail.title).toBe('Tuesday sync');
        expect(detail.meetingDetail!.meetingUrl).toBe('https://zoom.example.com/j/2');
      }
      expect(after[3]!.transcript).toBe('Only the fourth call');
      // The calls the job creates later follow the new rule and template.
      await materialiseDueSeries({ db: test.deps.db }, new Date(Date.now() + 21 * DAY));
      const more = await occurrences(seriesId);
      const last = more.at(-1)!;
      expect(more.length).toBeGreaterThan(after.length);
      expect(last.startsAt.toISOString()).toBe(occurrenceStart(rule, last.index!).toISOString());
      expect((await getItem(admin.cookie, last.id)).title).toBe('Tuesday sync');
    });

    it('"following" on a single call is refused', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(admin.cookie, group.id, draft(inDays(1), null));
      expect(item.meetingDetail!.series ?? null).toBeNull();
      const res = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
        title: 'X',
        seriesScope: 'following',
        updatedAt: item.updatedAt,
      });
      expect(res.statusCode).toBe(400);
      const del = await call('DELETE', `/api/knowledge/${item.id}?scope=following`, admin.cookie);
      expect(del.statusCode).toBe(400);
    });
  });

  describe('cancelling', () => {
    it('one call goes and is never created again', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(admin.cookie, group.id, draft(inDays(1), { frequency: 'weekly' }));
      const seriesId = item.meetingDetail!.series!.id;
      const calls = await occurrences(seriesId);
      const res = await call('DELETE', `/api/knowledge/${calls[8]!.id}`, admin.cookie);
      expect(res.statusCode).toBe(204);
      await materialiseDueSeries({ db: test.deps.db }, new Date(Date.now() + 7 * DAY));
      const after = await occurrences(seriesId);
      expect(after.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9]);
    });

    it('"this and following" ends the series', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(admin.cookie, group.id, draft(inDays(1), { frequency: 'weekly' }));
      const seriesId = item.meetingDetail!.series!.id;
      const calls = await occurrences(seriesId);
      const res = await call(
        'DELETE',
        `/api/knowledge/${calls[2]!.id}?scope=following`,
        admin.cookie,
      );
      expect(res.statusCode).toBe(204);
      expect((await occurrences(seriesId)).map((c) => c.index)).toEqual([0, 1]);
      await materialiseDueSeries({ db: test.deps.db }, new Date(Date.now() + 90 * DAY));
      expect(await occurrences(seriesId)).toHaveLength(2);
      expect((await getItem(admin.cookie, calls[0]!.id)).meetingDetail!.series).toMatchObject({
        ended: true,
        followingCount: 1,
      });
    });
  });

  describe('permissions (as single calls)', () => {
    it('a client of the group repeats their own call; others get 404', async () => {
      const group = await newGroup();
      const other = await newGroup();
      const client = await clientIn(group.id);
      const outsider = await clientIn(other.id);
      const ziadatel = await clientIn(group.id, 'ziadatel');
      const body = draft(inDays(1), { frequency: 'weekly', count: 2 });
      expect(
        (await call('POST', `/api/groups/${group.id}/knowledge`, outsider.cookie, body)).statusCode,
      ).toBe(404);
      expect(
        (await call('POST', `/api/groups/${group.id}/knowledge`, ziadatel.cookie, body)).statusCode,
      ).toBe(404);
      const own = await create(client.cookie, group.id, body);
      const calls = await occurrences(own.meetingDetail!.series!.id);
      const second = await getItem(client.cookie, calls[1]!.id);
      expect(second.canEdit).toBe(true);
      expect(second.createdBy.id).toBe(client.id);
      expect(
        (await call('GET', `/api/knowledge/${calls[1]!.id}`, outsider.cookie)).statusCode,
      ).toBe(404);
      const res = await call(
        'DELETE',
        `/api/knowledge/${calls[1]!.id}?scope=following`,
        client.cookie,
      );
      expect(res.statusCode).toBe(204);
    });

    it("a client cannot change or cancel an admin's series; an admins-only series stays hidden", async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const client = await clientIn(group.id);
      const item = await create(
        admin.cookie,
        group.id,
        draft(inDays(1), { frequency: 'weekly', count: 3 }),
      );
      const calls = await occurrences(item.meetingDetail!.series!.id);
      const second = await getItem(client.cookie, calls[1]!.id);
      expect(second.canEdit).toBe(false);
      const patch = await call('PATCH', `/api/knowledge/${second.id}`, client.cookie, {
        title: 'Hijack',
        seriesScope: 'following',
        updatedAt: second.updatedAt,
      });
      expect(patch.statusCode).toBe(403);
      const del = await call(
        'DELETE',
        `/api/knowledge/${second.id}?scope=following`,
        client.cookie,
      );
      expect(del.statusCode).toBe(403);
      expect(await occurrences(item.meetingDetail!.series!.id)).toHaveLength(3);

      const hidden = await create(
        admin.cookie,
        group.id,
        draft(
          inDays(1),
          { frequency: 'weekly', count: 2 },
          { visibility: 'admins', title: 'Internal' },
        ),
      );
      const hiddenCalls = await occurrences(hidden.meetingDetail!.series!.id);
      expect(
        (await call('GET', `/api/knowledge/${hiddenCalls[1]!.id}`, client.cookie)).statusCode,
      ).toBe(404);
      const list = await call(
        'GET',
        `/api/groups/${group.id}/knowledge?type=meeting`,
        client.cookie,
      );
      expect(KnowledgePageSchema.parse(list.json()).items.some((r) => r.title === 'Internal')).toBe(
        false,
      );
    });
  });

  describe('audit log', () => {
    it('a new series records its calls in one insert; "this and following" one row per changed call; the job records system rows', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(
        admin.cookie,
        group.id,
        draft(inDays(1), { frequency: 'weekly', count: 3 }),
      );
      const seriesId = item.meetingDetail!.series!.id;
      const calls = await occurrences(seriesId);
      const created = await auditRowsOfMany(
        test.deps.db,
        calls.map((c) => c.id),
      );
      expect(created.map((r) => r.action)).toEqual(['created', 'created', 'created']);
      expect(new Set(created.map((r) => r.createdAt.getTime())).size).toBe(1);
      expect(created.every((r) => r.actorUserId === admin.id)).toBe(true);

      const second = await getItem(admin.cookie, calls[1]!.id);
      const res = await call('PATCH', `/api/knowledge/${second.id}`, admin.cookie, {
        title: 'Tuesday sync',
        seriesScope: 'following',
        updatedAt: second.updatedAt,
      });
      expect(res.statusCode, res.body).toBe(200);
      const updated = (
        await auditRowsOfMany(
          test.deps.db,
          calls.map((c) => c.id),
        )
      ).filter((r) => r.action === 'updated');
      expect(updated.map((r) => r.entityId).sort()).toEqual([calls[1]!.id, calls[2]!.id].sort());
      expect(new Set(updated.map((r) => r.createdAt.getTime())).size).toBe(1);
      expect(updated[0]!.changes).toEqual({ title: { from: 'Weekly sync', to: 'Tuesday sync' } });
    });

    it('the materialise job records its new occurrences as system rows', async () => {
      const group = await newGroup();
      const admin = await newAdmin();
      const item = await create(admin.cookie, group.id, draft(inDays(1), { frequency: 'weekly' }));
      const seriesId = item.meetingDetail!.series!.id;
      const before = new Set((await occurrences(seriesId)).map((c) => c.id));
      await materialiseDueSeries({ db: test.deps.db }, new Date(Date.now() + 30 * DAY));
      const added = (await occurrences(seriesId)).filter((c) => !before.has(c.id));
      expect(added.length).toBeGreaterThan(0);
      const rows = await auditRowsOfMany(
        test.deps.db,
        added.map((c) => c.id),
      );
      expect(rows).toHaveLength(added.length);
      for (const row of rows) {
        expect(row).toMatchObject({
          action: 'created',
          actorKind: 'system',
          actorLabel: 'knowledge.meeting-series',
        });
      }
    });
  });
});
