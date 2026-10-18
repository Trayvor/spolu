import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FinanceItemDetail, FinanceOverviewDto, WorkLogPageDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { addManager } from '../groups/managers.js';
import { addMember, createGroup } from '../groups/service.js';
import { runProjectMergeHooks } from '../projects/merge-hooks.js';
import { createEvent, createProject } from '../projects/service.js';
import { buckets } from '../tasks/schema.js';
import { ensureBoard } from '../tasks/service.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, setFinanceAccess } from '../users/service.js';
import { financeContractShares, financeItems, financeRates, financeTimeEntries } from './schema.js';

/**
 * Finance by project and event (Phase 33 part P6, spec §11, decisions 23–25): the copies the
 * hooks keep on time entries (completion, a change of the subject's project, a ticket's move,
 * a merge, a delete), the Project and Event filters of the overview and the work log (per
 * currency, cost, a ticket unit split by project), the one-client rule of `/finance`, a
 * contract's and a manual entry's project, and who may use any of it.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;

describe('finance by project and event (Phase 33 P6)', () => {
  let test: TestApp;
  let superId: string;
  let fin: { id: string; cookie: string };
  let plain: { id: string; cookie: string };
  let client: { id: string; cookie: string };

  const db = () => test.deps.db;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    cookie: string = fin.cookie,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  /** A client whose board both admins manage (so they may be assignees). */
  const newGroup = async () => {
    const { id } = await createGroup(db(), {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    await addManager(db(), id, fin.id);
    await addManager(db(), id, plain.id);
    return id;
  };
  const project = async (groupId: string, name = 'Kultúra 2026') =>
    (await createProject(db(), superId, groupId, { name, description: '', fileIds: [] })).id;
  const event = async (projectId: string, name = 'Hodnotenie', occursOn = '2026-11-04') =>
    (await createEvent(db(), superId, projectId, { name, description: '', occursOn, fileIds: [] }))
      .id;
  const doneBucket = async (groupId: string) => {
    await ensureBoard(db(), groupId);
    const [row] = await db()
      .select({ id: buckets.id })
      .from(buckets)
      .where(and(eq(buckets.groupId, groupId), eq(buckets.kind, 'done')));
    return row!.id;
  };
  const entriesOf = (where: { taskId?: string; ticketId?: string }) =>
    db()
      .select({
        projectId: financeTimeEntries.projectId,
        eventId: financeTimeEntries.eventId,
        minutes: financeTimeEntries.minutes,
        groupId: financeTimeEntries.groupId,
      })
      .from(financeTimeEntries)
      .where(
        where.taskId
          ? eq(financeTimeEntries.taskId, where.taskId)
          : eq(financeTimeEntries.ticketId, where.ticketId!),
      );

  type EntryInput = {
    groupId: string | null;
    minutes: number | null;
    workedOn: string;
    projectId?: string | null;
    eventId?: string | null;
    source?: 'task' | 'ticket' | 'manual';
    ticketId?: string | null;
    linkedTicketId?: string | null;
    userId?: string;
  };
  async function entry(input: EntryInput): Promise<string> {
    const id = randomUUID();
    const source = input.source ?? 'manual';
    await db()
      .insert(financeTimeEntries)
      .values({
        id,
        groupId: input.groupId,
        userId: input.userId ?? fin.id,
        source,
        ticketId: input.ticketId ?? null,
        linkedTicketId: input.linkedTicketId ?? null,
        title: source === 'manual' ? null : 'Stored',
        minutes: input.minutes,
        workedOn: input.workedOn,
        projectId: input.projectId ?? null,
        eventId: input.eventId ?? null,
        createdBy: superId,
        updatedBy: superId,
      });
    return id;
  }
  async function contract(
    groupId: string,
    amountMinor: number,
    startsOn: string,
    opts: { projectId?: string | null; currency?: 'EUR' | 'UAH' } = {},
  ) {
    const id = randomUUID();
    await db()
      .insert(financeItems)
      .values({
        id,
        groupId,
        type: 'contract',
        title: 'Zmluva',
        amountMinor,
        currency: opts.currency ?? 'EUR',
        startsOn,
        endsOn: '2030-12-31',
        projectId: opts.projectId ?? null,
        createdBy: superId,
      });
    return id;
  }
  async function ticket(groupId: string | null, subject = 'Žiadosť') {
    const id = randomUUID();
    const at = new Date();
    await db()
      .insert(tickets)
      .values({ id, groupId, source: 'manual', subject, createdAt: at, updatedAt: at });
    return id;
  }
  const overview = async (path: string) => {
    const res = await call('GET', path);
    expect(res.statusCode, path).toBe(200);
    return res.json<FinanceOverviewDto>();
  };
  const workLog = async (path: string) => {
    const res = await call('GET', path);
    expect(res.statusCode, path).toBe(200);
    return res.json<WorkLogPageDto>();
  };

  beforeAll(async () => {
    test = await buildTestApp();
    superId = randomUUID();
    await db()
      .insert(user)
      .values({ id: superId, email: newEmail(), name: 'Super', role: 'superadmin' });
    const finEmail = newEmail();
    const finId = (await addAdmin(db(), { email: finEmail, name: 'Fin' })).id;
    await setFinanceAccess(db(), finId, superId);
    fin = { id: finId, cookie: await loginAs(test.app, finEmail) };
    await db()
      .insert(financeRates)
      .values({ id: randomUUID(), userId: finId, rateMinor: 6000, createdBy: superId });
    const plainEmail = newEmail();
    plain = {
      id: (await addAdmin(db(), { email: plainEmail, name: 'Plain' })).id,
      cookie: await loginAs(test.app, plainEmail),
    };
    const clientEmail = newEmail();
    const clientId = randomUUID();
    await db().insert(user).values({
      id: clientId,
      email: clientEmail,
      name: 'Client',
      role: 'client',
      emailVerified: true,
    });
    client = { id: clientId, cookie: await loginAs(test.app, clientEmail) };
  });
  afterAll(() => test.close());

  describe('the copies on time entries', () => {
    it('copies the project and event when a task is created in Completed or moved there', async () => {
      const groupId = await newGroup();
      const p = await project(groupId);
      const e = await event(p);
      const created = await call('POST', `/api/groups/${groupId}/tasks`, fin.cookie, {
        title: 'Hotovo',
        assigneeIds: [fin.id],
        bucketId: await doneBucket(groupId),
        projectId: p,
        eventId: e,
      });
      expect(created.statusCode, created.body).toBe(201);
      expect(await entriesOf({ taskId: created.json<{ id: string }>().id })).toEqual([
        { projectId: p, eventId: e, minutes: null, groupId },
      ]);

      const open = await call('POST', `/api/groups/${groupId}/tasks`, fin.cookie, {
        title: 'Otvorená',
        assigneeIds: [fin.id],
        projectId: p,
      });
      const taskId = open.json<{ id: string }>().id;
      const moved = await call('POST', `/api/tasks/${taskId}/move`, fin.cookie, {
        bucketId: await doneBucket(groupId),
        afterTaskId: null,
      });
      expect(moved.statusCode).toBe(200);
      expect(await entriesOf({ taskId })).toEqual([
        { projectId: p, eventId: null, minutes: null, groupId },
      ]);
    });

    it('copies the project of time filled before completion, and follows every later change', async () => {
      const groupId = await newGroup();
      const p = await project(groupId, 'A');
      const q = await project(groupId, 'B');
      const e = await event(q);
      const open = await call('POST', `/api/groups/${groupId}/tasks`, fin.cookie, {
        title: 'Skoro',
        assigneeIds: [fin.id, plain.id],
        projectId: p,
      });
      const task = open.json<{ id: string; updatedAt: string }>();
      expect(
        (await call('PUT', `/api/tasks/${task.id}/time/me`, fin.cookie, { minutes: 30 }))
          .statusCode,
      ).toBe(200);
      expect(await entriesOf({ taskId: task.id })).toEqual([
        { projectId: p, eventId: null, minutes: 30, groupId },
      ]);
      // Completion asks the other admin: the request carries the project too.
      await call('POST', `/api/tasks/${task.id}/move`, fin.cookie, {
        bucketId: await doneBucket(groupId),
        afterTaskId: null,
      });
      const before = await entriesOf({ taskId: task.id });
      expect(before.map((r) => r.projectId)).toEqual([p, p]);

      const fresh = (await call('GET', `/api/tasks/${task.id}`)).json<{ updatedAt: string }>();
      const patched = await call('PATCH', `/api/tasks/${task.id}`, fin.cookie, {
        projectId: q,
        eventId: e,
        updatedAt: fresh.updatedAt,
      });
      expect(patched.statusCode, patched.body).toBe(200);
      const after = await entriesOf({ taskId: task.id });
      expect(after.map((r) => [r.projectId, r.eventId])).toEqual([
        [q, e],
        [q, e],
      ]);

      const cleared = await call('PATCH', `/api/tasks/${task.id}`, fin.cookie, {
        projectId: null,
        updatedAt: patched.json<{ updatedAt: string }>().updatedAt,
      });
      expect(cleared.statusCode).toBe(200);
      expect((await entriesOf({ taskId: task.id })).map((r) => r.projectId)).toEqual([null, null]);
    });

    it('copies a ticket’s project on resolution, follows its project route and clears on a move', async () => {
      const groupId = await newGroup();
      const other = await newGroup();
      const p = await project(groupId);
      const e = await event(p);
      const id = await ticket(groupId);
      await call('PUT', `/api/tickets/${id}/project`, fin.cookie, { projectId: p, eventId: e });
      await call('PUT', `/api/tickets/${id}/assignees/${fin.id}`);
      expect(
        (await call('PATCH', `/api/tickets/${id}`, fin.cookie, { status: 'resolved' })).statusCode,
      ).toBe(200);
      expect(await entriesOf({ ticketId: id })).toEqual([
        { projectId: p, eventId: e, minutes: null, groupId },
      ]);

      await call('PUT', `/api/tickets/${id}/project`, fin.cookie, { projectId: p, eventId: null });
      expect(await entriesOf({ ticketId: id })).toEqual([
        { projectId: p, eventId: null, minutes: null, groupId },
      ]);

      expect(
        (await call('PUT', `/api/tickets/${id}/group`, fin.cookie, { groupId: other })).statusCode,
      ).toBe(200);
      expect(await entriesOf({ ticketId: id })).toEqual([
        { projectId: null, eventId: null, minutes: null, groupId: other },
      ]);
    });

    it('moves entries and contracts of a merged project to the survivor, only in its client', async () => {
      const groupId = await newGroup();
      const otherGroup = await newGroup();
      const from = await project(groupId, 'Duplicate');
      const into = await project(groupId, 'Survivor');
      const e = await event(from);
      const a = await entry({ groupId, minutes: 60, workedOn: '2026-03-01', projectId: from });
      const b = await entry({
        groupId,
        minutes: 30,
        workedOn: '2026-03-02',
        projectId: from,
        eventId: e,
      });
      // The same id in another client's rows is no concern of this merge.
      const c = await entry({
        groupId: otherGroup,
        minutes: 30,
        workedOn: '2026-03-02',
        projectId: from,
      });
      const k = await contract(groupId, 1000, '2026-01-01', { projectId: from });
      // The event moves with its project (P3 moves the row; its id stays).
      await db().transaction((tx) =>
        runProjectMergeHooks(tx, { groupId, fromProjectId: from, intoProjectId: into }),
      );
      const rows = await db()
        .select({
          id: financeTimeEntries.id,
          projectId: financeTimeEntries.projectId,
          eventId: financeTimeEntries.eventId,
        })
        .from(financeTimeEntries)
        .where(eq(financeTimeEntries.createdBy, superId));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(a)).toMatchObject({ projectId: into, eventId: null });
      expect(byId.get(b)).toMatchObject({ projectId: into, eventId: e });
      expect(byId.get(c)).toMatchObject({ projectId: from });
      const [item] = await db()
        .select({ projectId: financeItems.projectId })
        .from(financeItems)
        .where(eq(financeItems.id, k));
      expect(item!.projectId).toBe(into);
    });

    it('keeps the ids when the project is deleted; the filter then finds nothing new to offer', async () => {
      const groupId = await newGroup();
      const p = await project(groupId);
      const id = await entry({ groupId, minutes: 45, workedOn: '2026-04-01', projectId: p });
      expect((await call('DELETE', `/api/projects/${p}`)).statusCode).toBe(204);
      const [row] = await db()
        .select({ projectId: financeTimeEntries.projectId })
        .from(financeTimeEntries)
        .where(eq(financeTimeEntries.id, id));
      expect(row!.projectId).toBe(p);
      const picker = (await call('GET', `/api/groups/${groupId}/projects/picker`)).json<
        { id: string }[]
      >();
      expect(picker.map((x) => x.id)).not.toContain(p);
      // Asked by its old id, the time is still there.
      const page = await workLog(`/api/groups/${groupId}/finance/work-log?project=${p}`);
      expect(page.entries.map((x) => x.id)).toEqual([id]);
    });
  });

  describe('the filters', () => {
    it('filters the overview’s hours, cost and contract money by project, per currency', async () => {
      const groupId = await newGroup();
      const p = await project(groupId, 'A');
      const q = await project(groupId, 'B');
      await entry({ groupId, minutes: 60, workedOn: '2026-02-10', projectId: p });
      await entry({ groupId, minutes: 90, workedOn: '2026-02-11', projectId: q });
      await entry({ groupId, minutes: 30, workedOn: '2026-02-12' });
      await contract(groupId, 100000, '2026-01-01', { projectId: p });
      await contract(groupId, 500000, '2026-01-01', { projectId: p, currency: 'UAH' });
      await contract(groupId, 70000, '2026-01-01', { projectId: q });
      await contract(groupId, 9000, '2026-01-01');

      const all = await overview(`/api/groups/${groupId}/finance/overview?from=2026-01&to=2026-12`);
      expect(all.hours.minutes).toBe(180);
      const one = await overview(
        `/api/groups/${groupId}/finance/overview?from=2026-01&to=2026-12&project=${p}`,
      );
      expect(one.hours.minutes).toBe(60);
      expect(one.cost.total).toBe(6000);
      expect(one.money.map((m) => [m.currency, m.paid + m.toBePaid])).toEqual([
        ['EUR', 100000],
        ['UAH', 500000],
      ]);
      const none = await overview(
        `/api/groups/${groupId}/finance/overview?from=2026-01&to=2026-12&project=none`,
      );
      expect(none.hours.minutes).toBe(30);
      expect(none.money.map((m) => [m.currency, m.paid + m.toBePaid])).toEqual([['EUR', 9000]]);
    });

    it('filters by event: only its time, and no contract money (contracts have no event)', async () => {
      const groupId = await newGroup();
      const p = await project(groupId);
      const e = await event(p, 'Kickoff');
      const f = await event(p, 'Final', '2026-12-20');
      await entry({ groupId, minutes: 40, workedOn: '2026-05-01', projectId: p, eventId: e });
      await entry({ groupId, minutes: 50, workedOn: '2026-05-02', projectId: p, eventId: f });
      await entry({ groupId, minutes: 10, workedOn: '2026-05-03', projectId: p });
      await contract(groupId, 100000, '2026-01-01', { projectId: p });
      const byEvent = await overview(
        `/api/groups/${groupId}/finance/overview?from=2026-01&to=2026-12&project=${p}&event=${e}`,
      );
      expect(byEvent.hours.minutes).toBe(40);
      expect(byEvent.money).toEqual([]);
      const noEvent = await overview(
        `/api/groups/${groupId}/finance/overview?from=2026-01&to=2026-12&project=${p}&event=none`,
      );
      expect(noEvent.hours.minutes).toBe(10);
      const log = await workLog(`/api/groups/${groupId}/finance/work-log?project=${p}&event=${f}`);
      expect(log.entries.map((x) => x.minutes)).toEqual([50]);
      expect(log.summary?.minutes).toBe(50);
      expect(log.entries[0]).toMatchObject({ projectId: p, eventId: f });
    });

    it('splits a ticket unit by each entry’s own project', async () => {
      const groupId = await newGroup();
      const p = await project(groupId, 'A');
      const q = await project(groupId, 'B');
      const t = await ticket(groupId);
      await entry({
        groupId,
        minutes: 20,
        workedOn: '2026-06-01',
        source: 'ticket',
        ticketId: t,
        projectId: p,
      });
      await entry({
        groupId,
        minutes: 70,
        workedOn: '2026-06-02',
        source: 'task',
        linkedTicketId: t,
        projectId: q,
      });
      const a = await workLog(`/api/groups/${groupId}/finance/work-log?project=${p}`);
      expect(a.entries.map((x) => [x.source, x.minutes, x.unitTicketId])).toEqual([
        ['ticket', 20, t],
      ]);
      expect(a.summary?.minutes).toBe(20);
      expect(a.months.map((m) => m.minutes)).toEqual([20]);
      const b = await workLog(`/api/groups/${groupId}/finance/work-log?project=${q}`);
      expect(b.entries.map((x) => [x.source, x.minutes])).toEqual([['task', 70]]);
    });

    it('answers 400 for an event without a project, and on /finance for a project without exactly one client or any event', async () => {
      const groupId = await newGroup();
      const other = await newGroup();
      const p = await project(groupId);
      const bad = [
        `/api/groups/${groupId}/finance/overview?event=x`,
        `/api/groups/${groupId}/finance/overview?project=none&event=x`,
        `/api/groups/${groupId}/finance/work-log?event=x`,
        `/api/finance/overview?project=${p}`,
        `/api/finance/overview?clients=${groupId},${other}&project=${p}`,
        `/api/finance/work-log?project=${p}`,
        `/api/finance/overview?clients=${groupId}&project=${p}&event=x`,
      ];
      for (const url of bad) {
        expect((await call('GET', url)).json(), url).toEqual({ error: 'invalid_filter' });
      }
    });

    it('filters /finance by project with one client chosen; the rankings stay as they are', async () => {
      const groupId = await newGroup();
      const p = await project(groupId);
      await entry({ groupId, minutes: 25, workedOn: '2026-07-01', projectId: p });
      await entry({ groupId, minutes: 35, workedOn: '2026-07-02' });
      const one = await overview(
        `/api/finance/overview?clients=${groupId}&from=2026-01&to=2026-12&project=${p}`,
      );
      expect(one.hours.minutes).toBe(25);
      const log = await workLog(`/api/finance/work-log?clients=${groupId}&project=${p}`);
      expect(log.entries.map((x) => [x.minutes, x.groupName])).toEqual([[25, 'Firma']]);
      const hours = await call(
        'GET',
        `/api/finance/rankings/hours?clients=${groupId}&from=2026-01&to=2026-12&project=${p}`,
      );
      expect(hours.statusCode).toBe(200);
      expect(hours.json<{ rows: { minutes: number }[] }>().rows[0]?.minutes).toBe(60);
    });

    it('does not count the admin group as the one client on /finance: a project narrows to that client', async () => {
      // Phase 34 part E ticks the admin group "eGrant tím" by default; with one client and it,
      // the Project filter still applies, to that client alone (decision of 2026-10-18).
      const adminGroup = await ensureAdminGroup(db());
      const groupId = await newGroup();
      const p = await project(groupId);
      await entry({ groupId, minutes: 25, workedOn: '2019-05-01', projectId: p });
      await entry({ groupId, minutes: 35, workedOn: '2019-05-02' });
      await entry({ groupId: adminGroup, minutes: 40, workedOn: '2019-05-03' });
      const both = `clients=${groupId},${adminGroup}`;
      const period = 'from=2019-05&to=2019-05';

      const unfiltered = await overview(`/api/finance/overview?${both}&${period}`);
      expect(unfiltered.hours.minutes).toBeGreaterThanOrEqual(100);
      const one = await overview(`/api/finance/overview?${both}&${period}&project=${p}`);
      expect(one.hours.minutes).toBe(25);
      expect(one.organisation).toBe(false);
      const none = await overview(`/api/finance/overview?${both}&${period}&project=none`);
      expect(none.hours.minutes).toBe(35);
      const log = await workLog(`/api/finance/work-log?${both}&project=none`);
      expect(log.entries.map((x) => [x.minutes, x.groupName])).toEqual([[35, 'Firma']]);

      // The admin group alone is no client: a project is refused, as with every client.
      for (const url of [
        `/api/finance/overview?clients=${adminGroup}&project=none`,
        `/api/finance/work-log?clients=${adminGroup}&project=none`,
        `/api/finance/overview?project=none`,
        `/api/finance/overview?${both}&project=${p}&event=x`,
      ]) {
        expect((await call('GET', url)).json(), url).toEqual({ error: 'invalid_filter' });
      }
    });

    it('leaves the organisation’s expenses out of the admin group’s tab under a project filter', async () => {
      const adminGroup = await ensureAdminGroup(db());
      const created = await call('POST', '/api/finance/org/items', fin.cookie, {
        type: 'expense',
        expenseKind: 'other',
        title: 'Server',
        body: '',
        amount: { amountMinor: 4_321, currency: 'EUR' },
        spentOn: '2019-06-15',
        fileIds: [],
      });
      expect(created.statusCode, created.body).toBe(201);
      const path = `/api/groups/${adminGroup}/finance/overview?from=2019-06&to=2019-06`;
      const tab = await overview(path);
      expect(tab.organisation).toBe(true);
      expect(tab.expenses.length).toBeGreaterThan(0);
      const filtered = await overview(`${path}&project=none`);
      expect(filtered.organisation).toBe(false);
      expect(filtered.expenses).toEqual([]);
    });

    it('answers 403 to an admin without the right and to a client, whatever the filter', async () => {
      const groupId = await newGroup();
      await addMember(db(), groupId, client.id);
      const p = await project(groupId);
      for (const url of [
        `/api/groups/${groupId}/finance/overview?project=${p}`,
        `/api/groups/${groupId}/finance/work-log?project=${p}`,
        `/api/finance/overview?clients=${groupId}&project=${p}`,
      ]) {
        expect((await call('GET', url, plain.cookie)).statusCode, url).toBe(403);
        expect((await call('GET', url, client.cookie)).statusCode, url).toBe(403);
      }
    });
  });

  describe('contracts and manual entries', () => {
    const contractBody = (projectId?: string | null) => ({
      type: 'contract',
      title: 'Zmluva',
      amount: { amountMinor: 100000, currency: 'EUR' },
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      ...(projectId !== undefined ? { projectId } : {}),
    });

    it('names one of the client’s projects on a contract, never another client’s', async () => {
      const groupId = await newGroup();
      const other = await newGroup();
      const p = await project(groupId);
      const foreign = await project(other);
      const made = await call(
        'POST',
        `/api/groups/${groupId}/finance/items`,
        fin.cookie,
        contractBody(p),
      );
      expect(made.statusCode, made.body).toBe(201);
      const item = made.json<FinanceItemDetail>();
      expect(item.contract?.project).toMatchObject({ id: p, name: 'Kultúra 2026' });
      expect(item.contract?.projectId).toBe(p);
      expect(
        (
          await call(
            'POST',
            `/api/groups/${groupId}/finance/items`,
            fin.cookie,
            contractBody(foreign),
          )
        ).json(),
      ).toEqual({ error: 'invalid_project' });
      // A document has no project.
      expect(
        (
          await call('POST', `/api/groups/${groupId}/finance/items`, fin.cookie, {
            type: 'document',
            title: 'Doc',
            projectId: p,
          })
        ).statusCode,
      ).toBe(400);

      const cleared = await call('PATCH', `/api/finance/items/${item.id}`, fin.cookie, {
        projectId: null,
        updatedAt: item.updatedAt,
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json<FinanceItemDetail>().contract?.project).toBeNull();
      expect(
        (
          await call('PATCH', `/api/finance/items/${item.id}`, fin.cookie, {
            projectId: foreign,
            updatedAt: cleared.json<FinanceItemDetail>().updatedAt,
          })
        ).json(),
      ).toEqual({ error: 'invalid_project' });
    });

    it('refuses a project on a contract of several clients and on a document', async () => {
      const a = await newGroup();
      const b = await newGroup();
      const shared = await call('POST', '/api/finance/org/items', fin.cookie, {
        ...contractBody(),
        amount: { amountMinor: 20000, currency: 'EUR' },
        payerName: 'Mesto',
        shares: [
          { groupId: a, amountMinor: 10000 },
          { groupId: b, amountMinor: 10000 },
        ],
      });
      expect(shared.statusCode, shared.body).toBe(201);
      const item = shared.json<FinanceItemDetail>();
      const p = await project(a);
      expect(
        (
          await call('PATCH', `/api/finance/items/${item.id}`, fin.cookie, {
            projectId: p,
            updatedAt: item.updatedAt,
          })
        ).statusCode,
      ).toBe(400);
      const shares = await db()
        .select()
        .from(financeContractShares)
        .where(eq(financeContractShares.itemId, item.id));
      expect(shares).toHaveLength(2);
    });

    it('stores a manual entry’s project and event, checked against its client', async () => {
      const groupId = await newGroup();
      const other = await newGroup();
      const p = await project(groupId);
      const e = await event(p);
      const q = await project(groupId, 'B');
      const foreign = await project(other);
      const add = (body: object, url = `/api/groups/${groupId}/finance/time-entries`) =>
        call('POST', url, fin.cookie, {
          userId: fin.id,
          workedOn: '2026-03-03',
          minutes: 15,
          ...body,
        });
      const made = await add({ projectId: p, eventId: e });
      expect(made.statusCode).toBe(201);
      const id = made.json<{ id: string }>().id;
      const [row] = await db()
        .select({ projectId: financeTimeEntries.projectId, eventId: financeTimeEntries.eventId })
        .from(financeTimeEntries)
        .where(eq(financeTimeEntries.id, id));
      expect(row).toEqual({ projectId: p, eventId: e });

      expect((await add({ projectId: foreign })).json()).toEqual({ error: 'invalid_project' });
      expect((await add({ projectId: q, eventId: e })).json()).toEqual({
        error: 'invalid_project',
      });
      expect((await add({ eventId: e })).statusCode).toBe(400);
      expect(
        (await add({ groupId: null, projectId: p }, '/api/finance/time-entries')).json(),
      ).toEqual({ error: 'invalid_project' });

      // A new project without an event drops the old event.
      expect(
        (await call('PATCH', `/api/finance/time-entries/${id}`, fin.cookie, { projectId: q }))
          .statusCode,
      ).toBe(204);
      const [moved] = await db()
        .select({ projectId: financeTimeEntries.projectId, eventId: financeTimeEntries.eventId })
        .from(financeTimeEntries)
        .where(eq(financeTimeEntries.id, id));
      expect(moved).toEqual({ projectId: q, eventId: null });
    });

    it('refuses a project on a task or ticket entry: those follow their subject', async () => {
      const groupId = await newGroup();
      const p = await project(groupId);
      const id = await entry({ groupId, minutes: 5, workedOn: '2026-03-03', source: 'task' });
      expect(
        (await call('PATCH', `/api/finance/time-entries/${id}`, fin.cookie, { projectId: p }))
          .statusCode,
      ).toBe(400);
    });
  });
});
