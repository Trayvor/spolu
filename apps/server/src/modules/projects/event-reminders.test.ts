import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDto, ProjectEventDto, ReminderSetDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { fireDueReminders } from '../reminders/jobs.js';
import { reminderSets } from '../reminders/schema.js';
import { listUpcomingForUser } from '../reminders/service.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://r${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** F15: a project event as a reminder subject, for everyone who reads the group. */
describe('event reminders', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (method: Method, url: string, cookie?: string, payload?: object) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload ? { payload } : {}),
    });
  async function admin() {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel' = 'client') {
    const c = await createUnverifiedClient(db(), newEmail(), 'Klient');
    await addMembership(db(), c.id, groupId, role);
    return { ...c, cookie: await loginAs(test.app, c.email) };
  }
  async function setup() {
    const group = await createGroup(db(), { name: 'Obec Lúky', egrantUrl: newUrl() });
    const [a, client] = await Promise.all([admin(), member(group.id)]);
    const project = await call('POST', `/api/groups/${group.id}/projects`, a.cookie, {
      name: `Kultúra ${randomUUID().slice(0, 6)}`,
    });
    expect(project.statusCode).toBe(201);
    const event = await call(
      'POST',
      `/api/projects/${project.json<ProjectDto>().id}/events`,
      a.cookie,
      { name: 'Kickoff', occursOn: '2030-11-04' },
    );
    expect(event.statusCode).toBe(201);
    return { group, admin: a, client, event: event.json<ProjectEventDto>() };
  }
  const url = (eventId: string) => `/api/project-events/${eventId}/reminders`;

  it('a client of the group sets a reminder and adds another client; both are recipients', async () => {
    const { group, client, event } = await setup();
    const colleague = await member(group.id);
    const empty = await call('GET', url(event.id), client.cookie);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ times: [], recipients: [], subscribed: false, canEdit: true });

    const at = inHours(2);
    const res = await call('PUT', url(event.id), client.cookie, {
      times: [{ at }],
      recipientIds: [colleague.id],
    });
    expect(res.statusCode, res.body).toBe(200);
    const set = res.json<ReminderSetDto>();
    expect(set.times).toEqual([{ id: expect.any(String), at, firedAt: null }]);
    expect(set.recipients.map((r) => [r.user.id, r.source])).toEqual(
      expect.arrayContaining([
        [client.id, 'author'],
        [colleague.id, 'added'],
      ]),
    );
  });

  it("another group's client and a žiadateľ get 404 on every reminder route", async () => {
    const { group, admin: a, event } = await setup();
    await call('PUT', url(event.id), a.cookie, { times: [{ at: inHours(1) }] });
    const stranger = await member(
      (await createGroup(db(), { name: 'Iná', egrantUrl: newUrl() })).id,
    );
    const requester = await member(group.id, 'ziadatel');
    for (const person of [stranger, requester]) {
      const responses = await Promise.all([
        call('GET', url(event.id), person.cookie),
        call('PUT', url(event.id), person.cookie, { times: [{ at: inHours(1) }] }),
        call('POST', `${url(event.id)}/subscription`, person.cookie),
        call('GET', `${url(event.id)}/calendar.ics`, person.cookie),
      ]);
      for (const r of responses) expect(r.statusCode).toBe(404);
    }
  });

  it('a recipient from outside the group is 400 invalid_recipient', async () => {
    const { admin: a, event } = await setup();
    const stranger = await member(
      (await createGroup(db(), { name: 'Iná', egrantUrl: newUrl() })).id,
    );
    const res = await call('PUT', url(event.id), a.cookie, {
      times: [{ at: inHours(1) }],
      recipientIds: [stranger.id],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_recipient' });
  });

  it('the fire job notifies the recipients with an event payload; the upcoming list names the event', async () => {
    const { group, admin: a, client, event } = await setup();
    const at = inHours(1);
    await call('PUT', url(event.id), a.cookie, { times: [{ at }], recipientIds: [client.id] });

    const upcoming = await listUpcomingForUser(db(), { ...client, role: 'client' } as never, {
      limit: 10,
    });
    expect(upcoming).toEqual([
      expect.objectContaining({
        title: 'Kickoff',
        groupId: group.id,
        target: { kind: 'event', eventId: event.id },
      }),
    ]);

    const [set] = await db()
      .select({ id: reminderSets.id })
      .from(reminderSets)
      .where(eq(reminderSets.eventId, event.id));
    const fired = await fireDueReminders(
      { db: db(), jobs: test.deps.jobs },
      { now: new Date(Date.parse(at) + 30_000), setIds: [set!.id] },
    );
    expect(fired).toBe(1);
    const rows = await db()
      .select({ userId: notificationEvents.userId, payload: notificationEvents.payload })
      .from(notificationEvents)
      .where(
        and(eq(notificationEvents.kind, 'reminder.due'), eq(notificationEvents.groupId, group.id)),
      );
    expect(rows.map((r) => r.userId).sort()).toEqual([a.id, client.id].sort());
    expect(rows[0]!.payload).toMatchObject({
      subjectKind: 'event',
      subjectId: event.id,
      groupId: group.id,
      title: 'Kickoff',
    });
  });

  it('deleting the event deletes its reminders', async () => {
    const { admin: a, event } = await setup();
    await call('PUT', url(event.id), a.cookie, { times: [{ at: inHours(1) }] });
    expect((await call('DELETE', `/api/project-events/${event.id}`, a.cookie)).statusCode).toBe(
      204,
    );
    const left = await db()
      .select({ id: reminderSets.id })
      .from(reminderSets)
      .where(eq(reminderSets.eventId, event.id));
    expect(left).toEqual([]);
  });
});
