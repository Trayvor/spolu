import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { HomeMeetingsSchema, KnowledgeItemDtoSchema, type KnowledgeItemDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createFakeMeetingSummary, type MeetingSummaryProvider } from '../ai/meeting-summary.js';
import { addManager } from '../groups/managers.js';
import { addMember, createGroup } from '../groups/service.js';
import { setGroupMode } from '../notifications/modes.js';
import { notificationEvents } from '../notifications/schema.js';
import { fireDueReminders } from '../reminders/jobs.js';
import { user } from '../users/schema.js';
import { addAdmin, setNotificationChannel } from '../users/service.js';
import { MEETING_AI_JOB, meetingAiJobHandlers } from './meeting-ai.js';
import { knowledgeMeetings } from './schema.js';

// 2026-10-17: meeting notifications, and the Meetings card that follows them.

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

let test: TestApp;
let summaryImpl: MeetingSummaryProvider = createFakeMeetingSummary();
const meetingSummary: MeetingSummaryProvider = {
  summarize: (request, signal) => summaryImpl.summarize(request, signal),
};

beforeAll(async () => {
  test = await buildTestApp({ meetingSummary });
});
afterAll(async () => {
  await test.app.close();
  await test.close();
});

const db = () => test.deps.db;
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, payload?: unknown) =>
  test.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function admin(name = 'Meet Admin'): Promise<Person> {
  const email = newEmail();
  const row = await addAdmin(db(), { email, name });
  return { id: row.id, cookie: await loginAs(test.app, email) };
}

async function client(groupId: string, name = 'Meet Client'): Promise<Person> {
  const email = newEmail();
  const id = randomUUID();
  await db().insert(user).values({ id, email, name, role: 'client', emailVerified: true });
  await addMember(db(), groupId, id);
  return { id, cookie: await loginAs(test.app, email) };
}

const newGroup = () =>
  createGroup(db(), {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });

const draft = (over: Record<string, unknown> = {}, fields: Record<string, unknown> = {}) => ({
  type: 'meeting',
  title: 'Kickoff',
  body: '',
  meeting: { startsAt: inHours(24), ...fields },
  ...over,
});

async function create(cookie: string, groupId: string, body: Record<string, unknown>) {
  const res = await call('POST', `/api/groups/${groupId}/knowledge`, cookie, body);
  expect(res.statusCode, res.body).toBe(201);
  return KnowledgeItemDtoSchema.parse(res.json());
}

async function patch(cookie: string, item: KnowledgeItemDto, body: Record<string, unknown>) {
  const res = await call('PATCH', `/api/knowledge/${item.id}`, cookie, {
    updatedAt: item.updatedAt,
    ...body,
  });
  expect(res.statusCode, res.body).toBe(200);
  return KnowledgeItemDtoSchema.parse(res.json());
}

/** Who got an event of `kind` about `itemId`, sorted. */
async function recipients(kind: string, itemId: string): Promise<string[]> {
  const rows = await db()
    .select({ userId: notificationEvents.userId })
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.kind, kind),
        sql`${notificationEvents.payload}->>'itemId' = ${itemId}`,
      ),
    );
  return rows.map((r) => r.userId).sort();
}

describe('meeting.scheduled and meeting.rescheduled', () => {
  it('a new meeting notifies the group people but its author; the payload names it', async () => {
    const g = await newGroup();
    const a = await admin();
    const other = await admin('Other Admin');
    const c = await client(g.id);
    const item = await create(a.cookie, g.id, draft());
    const got = await recipients('meeting.scheduled', item.id);
    expect(got).toEqual(expect.arrayContaining([c.id, other.id]));
    expect(got).not.toContain(a.id);
    const [row] = await db()
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.kind, 'meeting.scheduled'),
          eq(notificationEvents.userId, c.id),
          sql`${notificationEvents.payload}->>'itemId' = ${item.id}`,
        ),
      );
    expect(row).toMatchObject({ groupId: g.id });
    expect(row!.payload).toEqual({
      itemId: item.id,
      groupId: g.id,
      title: 'Kickoff',
      startsAt: item.meetingDetail!.startsAt,
    });
  });

  it('an admins-only meeting notifies admins only', async () => {
    const g = await newGroup();
    const a = await admin();
    const other = await admin('Other Admin');
    const c = await client(g.id);
    const item = await create(a.cookie, g.id, draft({ visibility: 'admins' }));
    const got = await recipients('meeting.scheduled', item.id);
    expect(got).toContain(other.id);
    expect(got).not.toContain(c.id);
  });

  it('a meeting in the past notifies nobody; a client author is left out', async () => {
    const g = await newGroup();
    const a = await admin();
    const past = await create(a.cookie, g.id, draft({}, { startsAt: inHours(-2) }));
    expect(await recipients('meeting.scheduled', past.id)).toEqual([]);
    const c = await client(g.id);
    const own = await create(c.cookie, g.id, draft());
    const got = await recipients('meeting.scheduled', own.id);
    expect(got).toContain(a.id);
    expect(got).not.toContain(c.id);
  });

  it('moving the start notifies (to the future only); other edits do not', async () => {
    const g = await newGroup();
    const a = await admin();
    const c = await client(g.id);
    let item = await create(a.cookie, g.id, draft());
    item = await patch(a.cookie, item, { title: 'Kickoff 2', meeting: { meetingUrl: null } });
    expect(await recipients('meeting.rescheduled', item.id)).toEqual([]);
    item = await patch(a.cookie, item, { meeting: { startsAt: inHours(48) } });
    expect(await recipients('meeting.rescheduled', item.id)).toContain(c.id);
    await db().delete(notificationEvents).where(eq(notificationEvents.kind, 'meeting.rescheduled'));
    // The same start again, then a start in the past: nothing.
    item = await patch(a.cookie, item, { meeting: { startsAt: item.meetingDetail!.startsAt } });
    item = await patch(a.cookie, item, { meeting: { startsAt: inHours(-1) } });
    expect(await recipients('meeting.rescheduled', item.id)).toEqual([]);
  });

  it('no event for someone whose meetings channel is None', async () => {
    const g = await newGroup();
    const a = await admin();
    const c = await client(g.id);
    await setNotificationChannel(db(), c.id, 'meetings', 'none');
    const item = await create(a.cookie, g.id, draft());
    expect(await recipients('meeting.scheduled', item.id)).not.toContain(c.id);
  });
});

describe('the AI result', () => {
  it('summary ready goes to the admin who pressed the button, only', async () => {
    summaryImpl = createFakeMeetingSummary();
    const g = await newGroup();
    const a = await admin();
    const b = await admin('Presser');
    await client(g.id);
    const item = await create(a.cookie, g.id, draft({}, { transcript: 'Anna: Úloha: Zavolať.' }));
    const res = await call('POST', `/api/knowledge/${item.id}/meeting/process`, b.cookie);
    expect(res.statusCode, res.body).toBe(202);
    expect(await recipients('meeting.summary_ready', item.id)).toEqual([b.id]);
    expect(await recipients('meeting.summary_failed', item.id)).toEqual([]);
  });

  it('a run that fails for good tells the presser', async () => {
    summaryImpl = {
      summarize: () => Promise.reject(new Error('down')),
    };
    const g = await newGroup();
    const a = await admin();
    const item = await create(a.cookie, g.id, draft({}, { transcript: 'Anna: hello.' }));
    const res = await call('POST', `/api/knowledge/${item.id}/meeting/process`, a.cookie);
    expect(res.statusCode, res.body).toBe(202);
    // The first attempt failed; its retry is delayed (the inline queue skips it): no news yet.
    expect(await recipients('meeting.summary_failed', item.id)).toEqual([]);
    const [row] = await db()
      .select({ run: knowledgeMeetings.aiRun })
      .from(knowledgeMeetings)
      .where(eq(knowledgeMeetings.itemId, item.id));
    const handlers = meetingAiJobHandlers({
      db: db(),
      storage: test.deps.storage,
      media: test.deps.media,
      jobs: test.deps.jobs,
      ai: { transcription: null, summary: meetingSummary },
    });
    await handlers[MEETING_AI_JOB]!({
      itemId: item.id,
      run: row!.run,
      attempt: 3,
      requestedBy: a.id,
    });
    expect(await recipients('meeting.summary_failed', item.id)).toEqual([a.id]);
    expect(await recipients('meeting.summary_ready', item.id)).toEqual([]);
    summaryImpl = createFakeMeetingSummary();
  });
});

describe("a meeting's reminder", () => {
  it('carries meeting: true (the Meetings group); a reminder item does not', async () => {
    const g = await newGroup();
    const a = await admin();
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    // The author is always a recipient.
    const reminder = { times: [{ at: soon }], recipientIds: [] };
    const m = await create(a.cookie, g.id, draft({ reminder }));
    const r = await create(a.cookie, g.id, {
      type: 'reminder',
      title: 'Call',
      body: '',
      reminder,
    });
    await fireDueReminders(
      { db: db(), jobs: test.deps.jobs },
      { now: new Date(Date.now() + 10 * 60_000) },
    );
    const rows = await db()
      .select({ payload: notificationEvents.payload })
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.kind, 'reminder.due'),
          eq(notificationEvents.userId, a.id),
          inArray(sql`${notificationEvents.payload}->>'subjectId'`, [m.id, r.id]),
        ),
      );
    const bySubject = Object.fromEntries(
      rows.map((x) => {
        const p = x.payload as { subjectId: string; meeting?: boolean };
        return [p.subjectId, p.meeting ?? false];
      }),
    );
    expect(bySubject).toEqual({ [m.id]: true, [r.id]: false });
  });
});

describe('the Meetings card follows the notification settings', () => {
  const card = async (who: Person) => {
    const res = await call('GET', '/api/me/home/meetings', who.cookie);
    expect(res.statusCode, res.body).toBe(200);
    return HomeMeetingsSchema.parse(res.json());
  };
  const ids = async (who: Person) => {
    const c = await card(who);
    return [...c.upcoming, ...c.unsummarized].map((m) => m.id);
  };

  it('a manager (All messages) sees them; Mentions and replies or None hides them', async () => {
    const g = await newGroup();
    const a = await admin();
    await addManager(db(), g.id, a.id);
    const up = await create(a.cookie, g.id, draft());
    const past = await create(a.cookie, g.id, draft({}, { startsAt: inHours(-3) }));
    expect(await ids(a)).toEqual(expect.arrayContaining([up.id, past.id]));
    await setGroupMode(db(), a.id, g.id, 'mentions');
    expect(await ids(a)).not.toContain(up.id);
    expect(await ids(a)).not.toContain(past.id);
    await setGroupMode(db(), a.id, g.id, 'all');
    await setNotificationChannel(db(), a.id, 'meetings', 'none');
    const none = await card(a);
    expect(none).toEqual({
      upcomingTotal: 0,
      upcoming: [],
      unsummarizedTotal: 0,
      unsummarized: [],
    });
  });

  it("a recipient of the meeting's reminder sees it in any mode, Off included", async () => {
    const g = await newGroup();
    const a = await admin();
    await addManager(db(), g.id, a.id);
    await setGroupMode(db(), a.id, g.id, 'off');
    const plain = await create(a.cookie, g.id, draft({ title: 'Plain' }));
    const reminded = await create(
      a.cookie,
      g.id,
      draft(
        { title: 'Reminded', reminder: { times: [{ at: inHours(23) }], recipientIds: [] } },
        { startsAt: inHours(24) },
      ),
    );
    const shown = await ids(a);
    expect(shown).toContain(reminded.id);
    expect(shown).not.toContain(plain.id);
    const c = await card(a);
    expect(c.upcomingTotal).toBe(c.upcoming.length);
  });
});
