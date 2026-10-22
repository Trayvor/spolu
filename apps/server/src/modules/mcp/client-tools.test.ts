import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileInfo, SessionUser } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { callTool, mcpRequest, mcpToken } from '../../../test/mcp.js';
import { createFakeGraph, teamsConfig, type FakeGraph } from '../../../test/teams-graph.js';
import { createFakeBulkSender } from '../../infra/email/bulk.js';
import { createFakeProvider } from '../ai/fake-provider.js';
import { createFakeTextTools } from '../ai/text-tools.js';
import { createFakeTicketDraft } from '../ai/ticket-draft.js';
import { addManager } from '../groups/managers.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { insertSummary } from '../weekly-summary/test-fixtures.js';
import { createApiCaller, RouteNotAllowedError } from './call.js';
import type { ToolDef } from './tools/define.js';
import { ALL_TOOLS } from './tools/index.js';

/**
 * MCP for managers (ADR 0071): every tool walked as a manager (a client with an active `client`
 * membership), straight through its routes (`tool.run` with the manager's API caller, so no MCP
 * check is in the way). A tool marked `admin` must be refused by its own routes (403 or 404) on
 * the manager's own client, so hiding it only tidies `tools/list`; every other tool must succeed.
 * A new tool therefore needs a decision here: its arguments below, and `admin` or not.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Obj = Record<string, unknown>;

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
const day = (d: number) => inDays(d).toISOString().slice(0, 10);

/** The ids of one client's data, made by its admin. */
type Fixture = {
  groupId: string;
  channelId: string;
  adminMessageId: string;
  ticketId: string;
  taskId: string;
  bucketId: string;
  noteId: string;
  meetingId: string;
  projectId: string;
  eventId: string;
  fileId: string;
  summaryId: string;
  /** Unique words in the client's names and texts, for the search. */
  tag: string;
  /** The client's manager, and a message and a note they wrote. */
  manager: SessionUser;
  managerMessageId: string;
  managerNoteId: string;
};

describe('MCP for managers: every tool against the routes', () => {
  let test: TestApp;
  let graph: FakeGraph;
  let adminUser: SessionUser;
  let managerUser: SessionUser;
  /** The manager's client, and another client they have nothing to do with. */
  let own: Fixture;
  let foreign: Fixture;
  let managerToken: string;
  let campaignId: string;
  const tag = randomUUID().replaceAll('-', '').slice(0, 10);
  const week = `2032-W${String((parseInt(tag.slice(0, 4), 16) % 52) + 1).padStart(2, '0')}`;
  const cleanup: string[] = [];

  const sessionUser = (id: string, email: string, role: SessionUser['role']): SessionUser => ({
    id,
    email,
    name: role === 'client' ? 'Manažér' : 'Admin',
    role,
    finance: false,
  });

  /** Runs a tool straight through its routes as `as`; a refused allowlist entry counts as 403. */
  const run = async (tool: ToolDef, args: Obj, as: SessionUser) => {
    const parsed = tool.input.safeParse(args);
    if (!parsed.success) throw new Error(`${tool.name}: bad test arguments ${parsed.error}`);
    try {
      const outcome = await tool.run(
        { user: as, scope: 'write', api: createApiCaller(test.app, as, '127.0.0.1', 'write') },
        parsed.data,
        args,
      );
      return { status: outcome.status, data: outcome.data };
    } catch (error) {
      if (error instanceof RouteNotAllowedError) return { status: 403, data: null };
      throw error;
    }
  };
  const created = async (method: 'GET' | 'POST', path: string, body?: unknown, as = adminUser) => {
    const res = await createApiCaller(test.app, as, '127.0.0.1', 'write')(method, path, { body });
    expect({ path, ok: res.status < 300 }).toEqual({ path, ok: true });
    return res.body as Obj;
  };

  async function fixture(name: string, cookie: string): Promise<Fixture> {
    const db = test.deps.db;
    const ftag = `${name.slice(0, 3).toLowerCase()}${tag}`;
    const group = await createGroup(db, {
      name: `${name} ${ftag}`,
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.cz`,
    });
    const groupId = group.id;
    await addManager(db, groupId, adminUser.id);
    const channel = await created('GET', `/api/groups/${groupId}/chat`);
    const channelId = channel.id as string;
    const message = await created('POST', `/api/channels/${channelId}/messages`, {
      body: `- Pripraviť rozpočet ${ftag}\n- Podať žiadosť`,
      clientId: randomUUID(),
    });
    const ticket = await created('POST', '/api/tickets', {
      groupId,
      subject: `Faktúra ${ftag}`,
      body: '- Poslať faktúru\n- Overiť platbu',
    });
    const task = await created('POST', `/api/groups/${groupId}/tasks`, { title: `Úloha ${ftag}` });
    const board = await created('GET', `/api/groups/${groupId}/board`);
    const buckets = board.buckets as Obj[];
    const note = await created('POST', `/api/groups/${groupId}/knowledge`, {
      type: 'note',
      title: `Poznámka ${ftag}`,
      body: 'Obsah',
    });
    const meeting = await created('POST', `/api/groups/${groupId}/knowledge`, {
      type: 'meeting',
      title: `Stretnutie ${ftag}`,
      meeting: { startsAt: inDays(2).toISOString() },
    });
    const project = await created('POST', `/api/groups/${groupId}/projects`, {
      name: `Projekt ${ftag}`,
    });
    const event = await created('POST', `/api/projects/${project.id as string}/events`, {
      name: 'Termín',
      occursOn: day(10),
    });
    const upload = await test.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/files`,
      headers: { cookie, 'content-type': 'text/plain', 'x-file-name': 'notes.txt' },
      payload: Buffer.from(`Súbor ${name}`),
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const summaryId = await insertSummary(db, {
      groupId,
      week,
      status: 'sent',
      sentAt: new Date(),
    });

    const managerEmail = `${randomUUID()}@example.com`;
    const person = await createUnverifiedClient(db, managerEmail, `Manažér ${ftag}`);
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, person.id));
    await addMembership(db, person.id, groupId, 'client');
    const manager = sessionUser(person.id, managerEmail, 'client');
    const mine = await created(
      'POST',
      `/api/channels/${channelId}/messages`,
      { body: `Moja správa ${ftag}`, clientId: randomUUID() },
      manager,
    );
    const ownNote = await created(
      'POST',
      `/api/groups/${groupId}/knowledge`,
      { type: 'note', title: `Moja poznámka ${ftag}` },
      manager,
    );
    return {
      groupId,
      channelId,
      adminMessageId: message.id as string,
      ticketId: ticket.id as string,
      taskId: task.id as string,
      bucketId: buckets[0]!.id as string,
      noteId: note.id as string,
      meetingId: meeting.id as string,
      projectId: project.id as string,
      eventId: event.id as string,
      fileId: upload.json<FileInfo>().id,
      summaryId,
      tag: ftag,
      manager,
      managerMessageId: mine.id as string,
      managerNoteId: ownNote.id as string,
    };
  }

  beforeAll(async () => {
    graph = createFakeGraph();
    test = await buildTestApp({
      ai: createFakeProvider(),
      textTools: createFakeTextTools(),
      ticketDraft: createFakeTicketDraft(),
      bulkEmail: createFakeBulkSender(),
      config: { teams: teamsConfig() },
      teamsFetch: graph.fetch,
    });
    const db = test.deps.db;
    const adminEmail = `${randomUUID()}@example.com`;
    const admin = await addAdmin(db, { email: adminEmail, name: 'Ada Admin' });
    cleanup.push(admin.id);
    graph.addUser(adminEmail, 'Ada Admin', true);
    adminUser = sessionUser(admin.id, adminEmail, 'admin');
    const cookie = await loginAs(test.app, adminEmail);
    own = await fixture('Vlastná firma', cookie);
    foreign = await fixture('Cudzia firma', cookie);
    managerUser = own.manager;
    managerToken = await mcpToken(db, own.manager.id);
    campaignId = (await created('POST', '/api/bulk-email/campaigns', { name: 'Novinky' }))
      .id as string;
  });
  afterAll(async () => {
    for (const id of cleanup) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  /** Arguments for each tool on the manager's own client; several sets for several routes. */
  const argsOf = (f: Fixture): Record<string, Obj[]> => ({
    search: [{ q: f.tag }],
    search_messages: [{ q: f.tag }, { q: f.tag, groupId: f.groupId }],
    whoami: [{}],
    list_groups: [{}, { mine: true }],
    get_group: [{ groupId: f.groupId }],
    list_group_people: [{ groupId: f.groupId }],
    list_group_members: [{ groupId: f.groupId }, { groupId: f.groupId, which: 'requesters' }],
    list_admins: [{}],
    get_chat_channel: [{ groupId: f.groupId }, { taskId: f.taskId }, { ticketId: f.ticketId }],
    list_messages: [{ channelId: f.channelId }],
    get_thread: [{ messageId: f.adminMessageId }],
    list_unread_chats: [{}],
    send_message: [{ channelId: f.channelId, body: 'Ahoj' }],
    reply_to_ticket: [{ ticketId: f.ticketId, body: 'Ďakujem' }],
    get_messages_around: [{ messageId: f.adminMessageId }],
    list_channel_people: [{ channelId: f.channelId }],
    list_task_chats: [{ groupId: f.groupId }],
    edit_message: [{ messageId: f.managerMessageId, body: 'Opravené' }],
    react_to_message: [{ messageId: f.adminMessageId, emoji: '👍', on: true }],
    get_board: [{ groupId: f.groupId }],
    list_completed_tasks: [{ groupId: f.groupId, after: 'x' }],
    search_tasks: [{ groupId: f.groupId, q: 'Úloha' }],
    get_task: [{ taskId: f.taskId }],
    list_all_tasks: [{}],
    list_my_tasks: [{}],
    list_unseen_tasks: [{ groupId: f.groupId }],
    create_task: [{ groupId: f.groupId, task: { title: 'Nová úloha' } }],
    update_task: [{ taskId: f.taskId, changes: { title: 'Premenovaná' } }],
    move_task: [{ taskId: f.taskId, bucketId: f.bucketId, afterTaskId: null }],
    create_task_from_ticket: [
      { groupId: f.groupId, cards: { ticketId: f.ticketId, tasks: [{ title: 'Z tiketu' }] } },
    ],
    create_task_from_message: [
      {
        groupId: f.groupId,
        cards: { messageId: f.adminMessageId, tasks: [{ title: 'Zo správy' }] },
      },
    ],
    create_bucket: [{ groupId: f.groupId, name: 'Čaká' }],
    update_bucket: [{ bucketId: f.bucketId, changes: { name: 'Čaká' } }],
    list_tickets: [{ groupId: f.groupId }],
    get_ticket: [{ ticketId: f.ticketId }],
    list_ticket_assignee_candidates: [{ ticketId: f.ticketId }],
    create_ticket: [{ ticket: { groupId: f.groupId, subject: 'Otázka', body: 'Ako?' } }],
    update_ticket: [{ ticketId: f.ticketId, changes: { status: 'in_progress' } }],
    set_ticket_assignee: [{ ticketId: f.ticketId, userId: adminUser.id, assigned: true }],
    list_ticket_areas: [{ groupId: f.groupId }],
    set_ticket_areas: [{ groupId: f.groupId, rules: [] }],
    list_my_tickets: [{}],
    move_ticket_to_group: [{ ticketId: f.ticketId, groupId: f.groupId }],
    set_ticket_project: [{ ticketId: f.ticketId, projectId: f.projectId }],
    get_ticket_ratings_summary: [{}],
    list_ticket_ratings: [{ groupId: f.groupId }],
    get_ticket_watch: [{ groupId: f.groupId }],
    set_ticket_watch: [{ groupId: f.groupId, watching: true }],
    list_knowledge: [{ groupId: f.groupId }],
    list_knowledge_folders: [{ groupId: f.groupId }],
    get_knowledge_item: [{ itemId: f.noteId }],
    list_meetings: [{}],
    create_knowledge_item: [{ groupId: f.groupId, item: { type: 'note', title: 'Moja poznámka' } }],
    update_knowledge_item: [{ itemId: f.managerNoteId, changes: { title: 'Upravená' } }],
    list_projects: [{ groupId: f.groupId }],
    get_project: [{ projectId: f.projectId }],
    get_project_event: [{ eventId: f.eventId }],
    create_project: [{ groupId: f.groupId, project: { name: `Môj projekt ${randomUUID()}` } }],
    update_project: [{ projectId: f.projectId, changes: { name: `Iný ${randomUUID()}` } }],
    create_project_event: [
      { projectId: f.projectId, event: { name: 'Míľnik', occursOn: day(20) } },
    ],
    update_project_event: [{ eventId: f.eventId, changes: { name: 'Posunutý termín' } }],
    get_group_timeline: [{ groupId: f.groupId }],
    get_reminders: [
      { subject: 'task', id: f.taskId },
      { subject: 'project_event', id: f.eventId },
      { subject: 'knowledge', id: f.meetingId },
    ],
    set_reminders: [
      { subject: 'task', id: f.taskId, reminders: { times: [] } },
      { subject: 'project_event', id: f.eventId, reminders: { times: [] } },
    ],
    get_meeting_teams: [{ itemId: f.meetingId }],
    list_teams_invitees: [{ itemId: f.meetingId }],
    create_teams_meeting: [{ itemId: f.meetingId }],
    create_teams_series: [{ itemId: f.meetingId }],
    translate_message: [{ messageId: f.adminMessageId }],
    translate_ticket: [{ ticketId: f.ticketId }],
    draft_ticket_reply: [{ ticketId: f.ticketId }],
    suggest_ticket_task_split: [{ ticketId: f.ticketId }],
    suggest_message_task_split: [{ messageId: f.adminMessageId }],
    get_home_counts: [{}],
    list_mentions: [{}],
    list_notifications: [{}],
    list_upcoming_reminders: [{}],
    get_my_workload: [{}],
    list_bulk_campaigns: [{}],
    get_bulk_campaign: [{ campaignId }],
    list_bulk_campaign_recipients: [{ campaignId }],
    count_bulk_audience: [{ audience: { includeUserIds: [f.manager.id] } }],
    list_bulk_people: [{ audience: { includeUserIds: [f.manager.id] } }],
    search_bulk_people: [{ q: 'Mia' }],
    get_bulk_sender: [{}],
    create_bulk_campaign: [{ name: 'Moje novinky' }],
    update_bulk_campaign: [
      {
        campaignId,
        draft: {
          name: 'x',
          subject: 'x',
          preheader: '',
          blocks: [],
          audience: { includeUserIds: [f.manager.id] },
          version: 1,
        },
      },
    ],
    send_bulk_campaign_test: [{ campaignId }],
    list_weekly_summaries: [{ week, scope: 'all', status: 'all' }, { archive: true }],
    list_weekly_summary_clients: [{}],
    get_weekly_summary: [{ summaryId: f.summaryId }],
    get_my_weekly_summary: [{}],
    list_audit_log: [{}],
    get_notification_settings: [{}],
    update_notification_settings: [
      { groupMode: { groupId: f.groupId, mode: 'all' } },
      { channel: { category: 'tasks', channel: 'email' } },
    ],
    list_snippets: [{}],
    create_snippet: [{ snippet: { title: 'Pozdrav', body: 'Dobrý deň' } }],
    update_snippet: [{ snippetId: randomUUID(), changes: { title: 'x' } }],
    list_saved_views: [{ page: 'tickets' }],
    create_saved_view: [{ view: { page: 'tickets', name: 'Moje', url: '/tickets?assignee=me' } }],
    set_admin_substitution: [
      { adminId: adminUser.id, substitution: { substituteId: adminUser.id, endsOn: day(7) } },
    ],
    get_announcement: [{}],
    mark_announcement_seen: [{ announcementId: '2026-10-21' }],
    read_file: [{ fileId: f.fileId }],
  });

  /** Variants of a manager's tool that only admins get (the cross-client lists): refused. */
  const adminVariants = (f: Fixture): Record<string, Obj[]> => ({
    list_tickets: [{}],
    list_knowledge: [{}],
    list_group_members: [
      { groupId: f.groupId, which: 'invited' },
      { groupId: f.groupId, which: 'removed' },
    ],
  });
  /** Tools whose client id only filters what the user may read anyway: they answer empty. */
  const FILTERS_ONLY = ['search_messages'];
  const refused = (status: number) => status === 403 || status === 404;
  const managerTools = () => ALL_TOOLS.filter((t) => !t.finance && !t.admin);

  it('every tool is marked admin, finance, or works for a manager on their own client', async () => {
    const args = argsOf(own);
    for (const tool of ALL_TOOLS) {
      // Finance tools are refused before the route to anyone without the right (`leaks.test.ts`).
      if (tool.finance) continue;
      const sets = args[tool.name];
      expect({ tool: tool.name, hasArgs: sets !== undefined }).toEqual({
        tool: tool.name,
        hasArgs: true,
      });
      for (const set of sets!) {
        const { status, data } = await run(tool, set, managerUser);
        // An admin tool: its own routes refuse the manager, whatever MCP shows.
        if (tool.admin)
          expect.soft({ tool: tool.name, set, status }).toEqual({
            tool: tool.name,
            set,
            status: refused(status) ? status : 403,
          });
        else
          expect.soft({ tool: tool.name, set, status, data: status < 300 ? null : data }).toEqual({
            tool: tool.name,
            set,
            status: status < 300 ? status : 200,
            data: null,
          });
      }
    }
    for (const [name, sets] of Object.entries(adminVariants(own))) {
      const tool = ALL_TOOLS.find((t) => t.name === name)!;
      for (const set of sets)
        expect(refused((await run(tool, set, managerUser)).status)).toBe(true);
    }
  }, 120_000);

  it('no tool reads or changes another client (scope guarantee)', async () => {
    const args = argsOf(foreign);
    const foreignIds = [
      foreign.groupId,
      foreign.channelId,
      foreign.adminMessageId,
      foreign.ticketId,
      foreign.taskId,
      foreign.bucketId,
      foreign.noteId,
      foreign.meetingId,
      foreign.projectId,
      foreign.eventId,
      foreign.fileId,
      foreign.summaryId,
      foreign.managerMessageId,
      foreign.managerNoteId,
      foreign.manager.id,
    ];
    let scoped = 0;
    for (const tool of managerTools()) {
      for (const set of args[tool.name]!) {
        const { status, data } = await run(tool, set, managerUser);
        const named = JSON.stringify(set);
        const text = JSON.stringify(data ?? null);
        // Anything of the other client in the answer, beyond the ids the arguments named.
        const leaked = [...foreignIds, foreign.tag].filter(
          (id) => text.includes(id) && !named.includes(id),
        );
        if (foreignIds.some((id) => named.includes(id))) {
          // Pointed at the other client's data, read or write: refused. Only a search filtered
          // by that client answers, with nothing found.
          scoped += 1;
          const ok = refused(status) || (FILTERS_ONLY.includes(tool.name) && status === 200);
          expect.soft({ tool: tool.name, set, ok, leaked }).toEqual({
            tool: tool.name,
            set,
            ok: true,
            leaked: [],
          });
        } else {
          // Not pointed at it (search, whoami, lists of one's own): nothing of it in the answer.
          expect
            .soft({ tool: tool.name, set, leaked })
            .toEqual({ tool: tool.name, set, leaked: [] });
        }
      }
    }
    expect(scoped).toBeGreaterThan(50);
    // The other client's data is as its admin and manager left it.
    const task = await run(
      ALL_TOOLS.find((t) => t.name === 'get_task')!,
      { taskId: foreign.taskId },
      adminUser,
    );
    expect(task.data).toMatchObject({ title: `Úloha ${foreign.tag}` });
    const note = await run(
      ALL_TOOLS.find((t) => t.name === 'get_knowledge_item')!,
      { itemId: foreign.managerNoteId },
      adminUser,
    );
    expect(note.data).toMatchObject({ title: `Moja poznámka ${foreign.tag}` });
  }, 120_000);

  it('through /mcp: a manager lists only their tools and is refused an admin tool', async () => {
    const res = await mcpRequest(test.app, managerToken, 'tools/list');
    expect(res.statusCode).toBe(200);
    const names = (res.json() as { result: { tools: { name: string }[] } }).result.tools.map(
      (t) => t.name,
    );
    expect(names).toEqual(managerTools().map((t) => t.name));
    for (const name of [
      'list_admins',
      'list_audit_log',
      'list_bulk_campaigns',
      'get_my_workload',
    ]) {
      const result = await callTool(test.app, managerToken, name, {});
      expect({ name, json: result.json }).toEqual({
        name,
        json: expect.objectContaining({ status: 403, detail: 'not allowed for this user' }),
      });
    }
    const readOnly = await mcpToken(test.deps.db, managerUser.id, 'read');
    const readNames = (
      (await mcpRequest(test.app, readOnly, 'tools/list')).json() as {
        result: { tools: { name: string }[] };
      }
    ).result.tools.map((t) => t.name);
    expect(readNames).toEqual(
      managerTools()
        .filter((t) => !t.write)
        .map((t) => t.name),
    );
  });

  it('through /mcp: whoami and list_groups show the manager their own client only', async () => {
    const me = await callTool(test.app, managerToken, 'whoami');
    expect(me.json).toMatchObject({ id: managerUser.id, role: 'client', finance: false });
    const groups = await callTool(test.app, managerToken, 'list_groups');
    expect(groups.json).toEqual({
      total: 1,
      groups: [{ id: own.groupId, name: expect.any(String), kind: 'client', role: 'client' }],
      nextOffset: null,
    });
    const ticket = await callTool(test.app, managerToken, 'get_ticket', {
      ticketId: foreign.ticketId,
    });
    expect(ticket.json).toMatchObject({ status: 404 });
    const file = await callTool(test.app, managerToken, 'read_file', { fileId: foreign.fileId });
    expect(file.isError).toBe(true);
    expect(file.raw).not.toContain('Cudzia');
  });
});
