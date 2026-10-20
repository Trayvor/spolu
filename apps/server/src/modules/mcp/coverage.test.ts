import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';
import { callTool, mcpRequest, mcpToken } from '../../../test/mcp.js';
import { createFakeGraph, teamsConfig, type FakeGraph } from '../../../test/teams-graph.js';
import { createFakeBulkSender, type FakeBulkSender } from '../../infra/email/bulk.js';
import { createFakeProvider } from '../ai/fake-provider.js';
import { createFakeTextTools } from '../ai/text-tools.js';
import { createFakeTicketDraft } from '../ai/ticket-draft.js';
import { addManager } from '../groups/managers.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import {
  addAdmin,
  createUnverifiedClient,
  deactivateUser,
  setFinanceAccess,
} from '../users/service.js';
import { insertSummary } from '../weekly-summary/test-fixtures.js';
import { ALL_TOOLS } from './tools/index.js';

/**
 * The tools added for full coverage (owner 2026-10-21: every feature has MCP tools): each family
 * through the routes as the user, with fakes for AI, Microsoft Graph and bulk email; plus the
 * read-only token and the finance right.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Obj = Record<string, unknown>;

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
const day = (d: number) => inDays(d).toISOString().slice(0, 10);

describe('MCP coverage tools', () => {
  let test: TestApp;
  let graph: FakeGraph;
  let bulk: FakeBulkSender;
  let groupId: string;
  let otherGroupId: string;
  let admin: { id: string; email: string; token: string; readToken: string };
  let other: { id: string; token: string };
  let client: { id: string };
  const admins: string[] = [];
  // Unique per run: the test database is shared by many files and runs.
  const tag = randomUUID().replaceAll('-', '').slice(0, 10);
  const week = `2031-W${String((parseInt(tag.slice(0, 4), 16) % 52) + 1).padStart(2, '0')}`;

  const tool = (name: string, args: Obj = {}, token = admin.token) =>
    callTool(test.app, token, name, args);
  const ok = async (name: string, args: Obj = {}, token = admin.token) => {
    const res = await tool(name, args, token);
    expect({ name, isError: res.isError, json: res.isError ? res.json : null }).toEqual({
      name,
      isError: false,
      json: null,
    });
    return res.json as Obj;
  };
  const newAdmin = async (name: string) => {
    const email = `${randomUUID()}@example.com`;
    const a = await addAdmin(test.deps.db, { email, name });
    admins.push(a.id);
    return { id: a.id, email };
  };

  beforeAll(async () => {
    graph = createFakeGraph();
    bulk = createFakeBulkSender();
    test = await buildTestApp({
      ai: createFakeProvider(),
      textTools: createFakeTextTools(),
      ticketDraft: createFakeTicketDraft(),
      bulkEmail: bulk,
      config: { teams: teamsConfig() },
      teamsFetch: graph.fetch,
    });
    const db = test.deps.db;
    const a = await newAdmin('Ada Admin');
    graph.addUser(a.email, 'Ada Admin', true);
    admin = {
      ...a,
      token: await mcpToken(db, a.id),
      readToken: await mcpToken(db, a.id, 'read'),
    };
    const b = await newAdmin('Bob Admin');
    other = { id: b.id, token: await mcpToken(db, b.id) };
    // A foreign instance: translations are offered there.
    const g = await createGroup(db, {
      name: `Firma Coverage ${tag}`,
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.cz`,
    });
    groupId = g.id;
    await addManager(db, groupId, admin.id);
    otherGroupId = (
      await createGroup(db, {
        name: 'Iná firma',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      })
    ).id;
    const c = await createUnverifiedClient(db, `${randomUUID()}@example.com`, 'Cyril Klient');
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, c.id));
    await addMembership(db, c.id, groupId, 'client');
    client = { id: c.id };
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const newTicket = async (token = other.token) =>
    ok(
      'create_ticket',
      { ticket: { groupId, subject: 'Faktúra', body: '- Poslať faktúru\n- Overiť platbu' } },
      token,
    );

  it('weekly summaries, the audit log and the workload', async () => {
    const summaryId = await insertSummary(test.deps.db, { groupId, week });
    const list = (await ok('list_weekly_summaries', {
      week,
      scope: 'all',
      status: 'all',
    })) as { items: Obj[] };
    expect(list.items.map((s) => s.id)).toContain(summaryId);
    const archive = (await ok('list_weekly_summaries', { archive: true, groupId })) as {
      items: Obj[];
    };
    expect(archive.items.map((s) => s.id)).toContain(summaryId);
    const clients = (await ok('list_weekly_summary_clients', { q: tag })) as {
      items: Obj[];
    };
    expect(clients.items.map((g) => g.id)).toContain(groupId);
    expect(await ok('get_weekly_summary', { summaryId })).toMatchObject({ id: summaryId, groupId });
    expect(await ok('get_my_weekly_summary')).toHaveProperty('remind');

    const task = await ok('create_task', { groupId, task: { title: 'Auditovaná úloha' } });
    const audit = (await ok('list_audit_log', { entityType: 'task', entityId: task.id })) as {
      items: Obj[];
    };
    expect(audit.items.length).toBeGreaterThan(0);
    expect((await tool('list_audit_log', { entityId: 'x' })).json).toMatchObject({ status: 400 });

    const workload = (await ok('get_my_workload')) as { admins: Obj[]; week: unknown };
    // The shared test database holds many admins: the card's first 100 need not hold this one.
    expect(workload.admins.length).toBeGreaterThan(0);
    expect(workload.week).toBeNull();
    // The week's minutes are finance: only in a finance holder's answer.
    expect(JSON.stringify(workload)).not.toContain('minutesThisWeek');
    const fin = await newAdmin('Fina Admin');
    await setFinanceAccess(test.deps.db, fin.id, fin.id);
    const finToken = await mcpToken(test.deps.db, fin.id);
    const finWorkload = (await ok('get_my_workload', {}, finToken)) as { week: unknown };
    expect(finWorkload.week).not.toBeNull();
  });

  it('AI helpers suggest without changing anything, also for a read-only token', async () => {
    const ticket = await newTicket();
    const ticketId = ticket.id as string;
    const channel = await ok('get_chat_channel', { groupId });
    const message = await ok(
      'send_message',
      { channelId: channel.id, body: '- Pripraviť rozpočet\n- Podať žiadosť' },
      other.token,
    );
    const translated = await ok('translate_message', { messageId: message.id }, admin.readToken);
    expect(translated).toHaveProperty('text');
    expect(await ok('translate_ticket', { ticketId }, admin.readToken)).toHaveProperty('text');
    // Never one's own text.
    expect(
      (await tool('translate_message', { messageId: message.id }, other.token)).json,
    ).toMatchObject({ status: 403 });
    expect(
      await ok('draft_ticket_reply', { ticketId, instructions: 'stručne' }, admin.readToken),
    ).toHaveProperty('reply');
    const split = (await ok('suggest_ticket_task_split', { ticketId })) as { tasks: Obj[] };
    expect(split.tasks.length).toBe(2);
    const fromMessage = (await ok('suggest_message_task_split', { messageId: message.id })) as {
      tasks: Obj[];
    };
    expect(fromMessage.tasks.map((t) => t.title)).toEqual(['Pripraviť rozpočet', 'Podať žiadosť']);
  });

  it('tasks from a ticket and a message, buckets and reminders', async () => {
    const ticket = await newTicket();
    const fromTicket = (await ok('create_task_from_ticket', {
      groupId,
      cards: { ticketId: ticket.id, tasks: [{ title: 'Z tiketu' }] },
    })) as { tasks: Obj[] };
    expect(fromTicket.tasks[0]).toMatchObject({ title: 'Z tiketu' });
    const channel = await ok('get_chat_channel', { groupId });
    const message = await ok('send_message', { channelId: channel.id, body: 'Urobme to' });
    const fromMessage = (await ok('create_task_from_message', {
      groupId,
      cards: { messageId: message.id, tasks: [{ title: 'Zo správy' }] },
    })) as { tasks: Obj[] };
    expect(fromMessage.tasks[0]).toMatchObject({ title: 'Zo správy' });
    expect(
      (
        await tool('create_task_from_message', {
          groupId: otherGroupId,
          cards: { messageId: message.id, tasks: [{ title: 'x' }] },
        })
      ).json,
    ).toMatchObject({ status: 404 });

    const bucket = await ok('create_bucket', { groupId, name: 'Čaká na klienta' });
    expect(
      await ok('update_bucket', { bucketId: bucket.id, changes: { name: 'Čaká' } }),
    ).toMatchObject({ name: 'Čaká' });

    const taskId = fromTicket.tasks[0]!.id as string;
    const at = inDays(3).toISOString();
    const set = (await ok('set_reminders', {
      subject: 'task',
      id: taskId,
      reminders: { times: [{ at }] },
    })) as { times: Obj[] };
    expect(set.times).toHaveLength(1);
    const read = (await ok('get_reminders', { subject: 'task', id: taskId })) as { times: Obj[] };
    expect(read.times.map((t) => t.id)).toEqual(set.times.map((t) => t.id));
    // Without baseTimeIds the times replace the current ones.
    const cleared = (await ok('set_reminders', {
      subject: 'task',
      id: taskId,
      reminders: { times: [] },
    })) as { times: Obj[] };
    expect(cleared.times).toEqual([]);
    expect(
      (await tool('get_reminders', { subject: 'knowledge', id: randomUUID() })).json,
    ).toMatchObject({ status: 404 });
  });

  it('tickets: mine, move, project, ratings, watch', async () => {
    await ok('list_my_tickets', { status: 'all' });
    const ticket = await newTicket();
    const moved = await ok('move_ticket_to_group', { ticketId: ticket.id, groupId: otherGroupId });
    expect(moved).toMatchObject({ groupId: otherGroupId });
    await ok('move_ticket_to_group', { ticketId: ticket.id, groupId });
    const project = await ok('create_project', { groupId, project: { name: `P ${randomUUID()}` } });
    expect(
      await ok('set_ticket_project', { ticketId: ticket.id, projectId: project.id }),
    ).toMatchObject({ project: { id: project.id } });
    await ok('set_ticket_project', { ticketId: ticket.id, projectId: null });
    expect(await ok('get_ticket_ratings_summary', { days: 90 })).toBeTruthy();
    expect(await ok('list_ticket_ratings', { groupId })).toHaveProperty('items');
    expect(await ok('set_ticket_watch', { groupId, watching: false })).toEqual({ watching: false });
    expect(await ok('get_ticket_watch', { groupId })).toEqual({ watching: false });
    await ok('set_ticket_watch', { groupId, watching: true });
  });

  it('chat: around, people, task chats, edit and react', async () => {
    const channel = await ok('get_chat_channel', { groupId });
    const sent = await ok('send_message', { channelId: channel.id, body: 'Pôvodný text' });
    const around = await ok('get_messages_around', { messageId: sent.id, limit: 5 });
    expect(JSON.stringify(around)).toContain(sent.id as string);
    const people = (await ok('list_channel_people', {
      channelId: channel.id,
    })) as unknown as Obj[];
    expect(people.map((p) => p.id)).toContain(client.id);
    await ok('list_task_chats', { groupId });
    expect(await ok('edit_message', { messageId: sent.id, body: 'Nový text' })).toMatchObject({
      body: 'Nový text',
    });
    const reacted = (await ok('react_to_message', {
      messageId: sent.id,
      emoji: '👍',
      on: true,
    })) as { reactions: Obj[] };
    expect(JSON.stringify(reacted.reactions)).toContain('👍');
    // Someone else's message: the route's 403.
    expect(
      (await tool('edit_message', { messageId: sent.id, body: 'x' }, other.token)).json,
    ).toMatchObject({ status: 403 });
  });

  it('settings: notifications, snippets, saved views, a substitution', async () => {
    const settings = (await ok('get_notification_settings')) as { preferences: Obj; modes: Obj };
    expect(settings.preferences).toHaveProperty('channels');
    const changed = (await ok('update_notification_settings', {
      channel: { category: 'tasks', channel: 'email' },
      defaultMode: 'mentions',
      groupMode: { groupId, mode: 'all' },
    })) as { preferences: { channels: Obj } };
    expect(changed.preferences.channels.tasks).toBe('email');

    const snippet = await ok('create_snippet', {
      snippet: { title: 'Pozdrav', body: 'Dobrý deň {{name}}' },
    });
    expect(
      await ok('update_snippet', { snippetId: snippet.id, changes: { shared: true } }),
    ).toMatchObject({ shared: true });
    expect(JSON.stringify(await ok('list_snippets'))).toContain(snippet.id as string);
    expect(
      (
        await tool(
          'update_snippet',
          { snippetId: snippet.id, changes: { title: 'x' } },
          other.token,
        )
      ).json,
    ).toMatchObject({ status: 403 });

    const view = await ok('create_saved_view', {
      view: { page: 'tickets', name: 'Moje', url: '/tickets?assignee=me' },
    });
    expect(JSON.stringify(await ok('list_saved_views', { page: 'tickets' }))).toContain(
      view.id as string,
    );
    // The finance page is the finance holders': the route's 403.
    expect((await tool('list_saved_views', { page: 'finance' })).json).toMatchObject({
      status: 403,
    });

    const away = await newAdmin('Away Admin');
    const sub = await ok('set_admin_substitution', {
      adminId: away.id,
      substitution: { substituteId: other.id, endsOn: day(7) },
    });
    expect(JSON.stringify(sub)).toContain(other.id);
  });

  it('bulk email: audience reads, a draft and a test to oneself only', async () => {
    const audience = { includeUserIds: [client.id] };
    expect(await ok('count_bulk_audience', { audience }, admin.readToken)).toBeTruthy();
    const people = await ok('list_bulk_people', { audience }, admin.readToken);
    expect(JSON.stringify(people)).toContain(client.id);
    await ok('search_bulk_people', { q: 'Cyril' });
    expect(await ok('get_bulk_sender')).toHaveProperty('sender');
    const campaign = await ok('create_bulk_campaign', { name: 'Novinky' });
    const saved = await ok('update_bulk_campaign', {
      campaignId: campaign.id,
      draft: {
        name: 'Novinky',
        subject: 'Čo je nové',
        preheader: '',
        blocks: [{ id: 'b1', type: 'heading', text: 'Ahoj {{name}}', align: 'left' }],
        audience,
        version: campaign.version,
      },
    });
    expect(saved).toMatchObject({ subject: 'Čo je nové' });
    bulk.sent.length = 0;
    expect(await ok('send_bulk_campaign_test', { campaignId: campaign.id })).toEqual({
      to: admin.email,
    });
    expect(bulk.sent.map((m) => m.to)).toEqual([[admin.email]]);
    expect(await ok('get_bulk_campaign', { campaignId: campaign.id })).toMatchObject({
      status: 'draft',
    });
  });

  it('Teams: reads the block and creates a meeting through the Graph fake', async () => {
    const item = await ok('create_knowledge_item', {
      groupId,
      item: { type: 'meeting', title: 'Kickoff', meeting: { startsAt: inDays(1).toISOString() } },
    });
    expect(await ok('get_meeting_teams', { itemId: item.id })).toEqual({ link: null });
    const invitees = (await ok('list_teams_invitees', { itemId: item.id })) as unknown as Obj[];
    expect(invitees.map((p) => p.id)).toContain(client.id);
    const created = (await ok('create_teams_meeting', {
      itemId: item.id,
      attendees: [{ email: 'guest@example.com' }],
    })) as { link: Obj };
    expect(created.link).toMatchObject({ origin: 'help' });
    expect(graph.events.length).toBeGreaterThan(0);
  });

  it('the timeline of a client', async () => {
    // Another admin's token: the user's 30 changes a minute are spent by the tests above.
    const project = await ok(
      'create_project',
      { groupId, project: { name: `T ${randomUUID()}` } },
      other.token,
    );
    const event = await ok(
      'create_project_event',
      { projectId: project.id, event: { name: 'Termín', occursOn: day(10) } },
      other.token,
    );
    const timeline = await ok('get_group_timeline', { groupId, project: project.id });
    expect(JSON.stringify(timeline)).toContain(event.id as string);
  });

  it('a read-only token lists no write tool and is refused each one', async () => {
    const res = await mcpRequest(test.app, admin.readToken, 'tools/list');
    const names = (res.json() as { result: { tools: { name: string }[] } }).result.tools.map(
      (t) => t.name,
    );
    for (const t of ALL_TOOLS) {
      expect({ name: t.name, listed: names.includes(t.name) }).toEqual({
        name: t.name,
        listed: !t.write && !t.finance,
      });
    }
    for (const name of [
      'create_task_from_ticket',
      'set_reminders',
      'set_ticket_watch',
      'edit_message',
      'update_notification_settings',
      'create_bulk_campaign',
      'send_bulk_campaign_test',
      'create_teams_meeting',
      'set_admin_substitution',
    ]) {
      const refused = await tool(name, {}, admin.readToken);
      expect({ name, json: refused.json }).toMatchObject({
        name,
        json: { status: 403, detail: 'read-only token' },
      });
    }
  });
});
