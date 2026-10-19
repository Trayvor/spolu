import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { KnowledgeDraft, SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { messages } from '../chat/schema.js';
import { ensureTicketChannel } from '../chat/service.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { createFolder } from '../knowledge/folders.js';
import { createItem } from '../knowledge/service.js';
import { tickets } from '../tickets/schema.js';
import { getTicketRow, type TicketRow } from '../tickets/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { buildTicketDraftContext } from './ticket-draft-context.js';

const { db, close } = createDb(testDatabaseUrl);
const counting = createCountingDb();
let admin: SessionUser;
let adminGroup: string;

beforeAll(async () => {
  adminGroup = await ensureAdminGroup(db);
  const email = `${randomUUID()}@example.com`;
  const a = await addAdmin(db, { email, name: 'Ada Tímová' });
  admin = { id: a.id, email, name: 'Ada Tímová', role: 'admin', finance: false };
});
afterAll(() => Promise.all([close(), counting.close()]));

const word = () =>
  `zq${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
const newGroup = (name: string) =>
  createGroup(db, { name, egrantUrl: `https://c${randomUUID().replaceAll('-', '')}.egrant.sk` });
const note = async (groupId: string, title: string, over: Partial<KnowledgeDraft> = {}) =>
  (
    await createItem({ db }, admin, groupId, {
      type: 'note',
      title,
      body: '',
      visibility: 'public',
      fileIds: [],
      folderId: null,
      ...over,
    } as KnowledgeDraft)
  ).item.id;

async function person(groupId: string, name: string) {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    email: `${randomUUID()}@example.com`,
    name,
    role: 'client',
    emailVerified: true,
  });
  await addMembership(db, id, groupId, 'client');
  return id;
}

async function ticket(over: Partial<typeof tickets.$inferInsert>): Promise<TicketRow> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(tickets).values({
    id,
    groupId: null,
    status: 'new',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...over,
  });
  return (await getTicketRow(db, id))!;
}

let seq = 0;
async function say(ticketRow: TicketRow, authorId: string, body: string) {
  const channel = await ensureTicketChannel(db, { id: ticketRow.id, groupId: ticketRow.groupId! });
  seq++;
  await db.insert(messages).values({
    id: randomUUID(),
    channelId: channel.id,
    authorId,
    body,
    clientId: randomUUID(),
    changeSeq: seq,
    createdAt: new Date(Date.now() + seq * 1000),
  });
}

/** Two clients with the same matching texts and the admin group's shared and internal items. */
async function scene() {
  const w = word();
  const a = await newGroup('Firma Alfa');
  const b = await newGroup('Obec Horná Lehota');
  const clientA = await person(a.id, 'Klára Alfová');
  const memberB = await person(b.id, 'Peter Veľký');
  const ownNote = await note(a.id, `Zmena rozpočtu ${w}`);
  const otherNote = await note(b.id, `Zmena rozpočtu ${w}`);
  const adminsOnly = await note(a.id, `Interné ${w}`, { visibility: 'admins' });
  const shared = await note(adminGroup, `Spoločný postup ${w}`);
  const folder = await createFolder(db, admin, adminGroup, {
    name: `Interné ${w}`,
    parentId: null,
    visibility: 'admins',
  });
  const internal = await note(adminGroup, `Interný postup ${w}`, { folderId: folder.id });
  const resolvedB = await ticket({
    groupId: b.id,
    status: 'resolved',
    resolvedAt: new Date(),
    subject: `Rozpočet ${w} pre Obec Horná Lehota`,
    body: `Dobrý deň, píše Ján Novák, jan.novak@lehota.sk, +421 905 123 456. ${w}`,
    requesterName: 'Ján Novák',
    requesterEmail: 'jan.novak@lehota.sk',
    requesterPhone: '+421 905 123 456',
  });
  await say(resolvedB, memberB, 'Ďakujem');
  await say(resolvedB, admin.id, `Pán Peter Veľký, posielame postup pre ${w}.`);
  const current = await ticket({
    groupId: a.id,
    subject: `Zmena rozpočtu ${w}`,
    body: 'Ako postupovať?',
    requesterName: 'Klára Alfová',
  });
  await say(current, clientA, `Prosím o radu k ${w}`);
  return { w, a, b, ownNote, otherNote, adminsOnly, shared, internal, resolvedB, current };
}

describe('buildTicketDraftContext', () => {
  it("uses knowledge of the ticket's client and shareable admin-group items only", async () => {
    const s = await scene();
    const { request } = await buildTicketDraftContext(db, s.current, '');
    const ids = request.knowledge.map((k) => k.id);
    expect(ids).toEqual(expect.arrayContaining([s.ownNote, s.shared]));
    const json = JSON.stringify(request);
    for (const id of [s.otherNote, s.adminsOnly, s.internal]) expect(json).not.toContain(id);
    expect(request.ticket.requesterFirstName).toBe('Klára');
    expect(request.conversation).toEqual([
      { author: 'Klára Alfová', role: 'client', text: `Prosím o radu k ${s.w}` },
    ]);
    expect(request.fallbackLanguage).toBe('Slovak');
  });

  it("uses another client's ticket as an example with its identity masked", async () => {
    const s = await scene();
    const context = await buildTicketDraftContext(db, s.current, '');
    const example = context.request.similarTickets.find((t) => t.id === s.resolvedB.id);
    expect(example).toBeDefined();
    const json = JSON.stringify(context.request);
    for (const leak of [
      'Lehota',
      'Novák',
      'Ján',
      'jan.novak',
      'lehota.sk',
      '905 123',
      'Peter',
      'Veľký',
    ]) {
      expect(json).not.toContain(leak);
    }
    expect(example!.subject).toContain('[klient]');
    expect(example!.body).toContain('[meno]');
    expect(example!.body).toContain('[e-mail]');
    expect(example!.body).toContain('[telefón]');
    expect(example!.answers).toEqual([`Pán [meno] [meno], posielame postup pre ${s.w}.`]);
    expect(context.otherClientIdentities.clients).toContain('Obec Horná Lehota');
    expect(context.otherClientIdentities.names).toEqual(
      expect.arrayContaining(['Ján Novák', 'Peter Veľký']),
    );
    expect(context.sources.get(s.resolvedB.id)).toEqual({
      kind: 'ticket',
      id: s.resolvedB.id,
      number: s.resolvedB.number,
      subject: s.resolvedB.subject,
    });
  });

  it('masks the requester of a similar ticket of the same client', async () => {
    const s = await scene();
    const same = await ticket({
      groupId: s.a.id,
      status: 'resolved',
      resolvedAt: new Date(),
      subject: `Rozpočet ${s.w}`,
      body: 'Eva Malá, eva@alfa.sk',
      requesterName: 'Eva Malá',
      requesterEmail: 'eva@alfa.sk',
    });
    const { request } = await buildTicketDraftContext(db, s.current, '');
    const example = request.similarTickets.find((t) => t.id === same.id)!;
    expect(example.body).toBe('[meno] [meno], [e-mail]');
  });

  it('a ticket without a client uses only shareable admin-group items, examples masked', async () => {
    const s = await scene();
    const orphan = await ticket({ subject: `Zmena rozpočtu ${s.w}`, body: '' });
    const { request, sources } = await buildTicketDraftContext(db, orphan, '');
    expect(request.knowledge.map((k) => k.id)).toContain(s.shared);
    for (const k of request.knowledge) {
      expect(sources.get(k.id)).toMatchObject({ kind: 'knowledge', fromAdminGroup: true });
    }
    expect(request.similarTickets.map((t) => t.id)).toContain(s.resolvedB.id);
    expect(JSON.stringify(request)).not.toContain('Lehota');
  });

  it('no terms means no sources', async () => {
    const a = await newGroup('Firma');
    const t = await ticket({ groupId: a.id, subject: '?', body: '' });
    const context = await buildTicketDraftContext(db, t, '');
    expect(context.request.knowledge).toEqual([]);
    expect(context.request.similarTickets).toEqual([]);
    expect(context.sources.size).toBe(0);
  });

  it('stays within 10 queries (11 with the ticket lookup)', async () => {
    const s = await scene();
    await counting.db.execute(sql`select 1`); // the client's first query reads its types
    counting.reset();
    const context = await buildTicketDraftContext(counting.db, s.current, 'Stručne');
    expect(context.request.similarTickets.length).toBeGreaterThan(0);
    expect(context.request.instructions).toBe('Stručne');
    expect(counting.count()).toBeLessThanOrEqual(10);
  });
});
