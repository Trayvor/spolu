import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { AiStatusSchema, TicketDraftSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { messages } from '../chat/schema.js';
import { ensureTicketChannel } from '../chat/service.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { createItem } from '../knowledge/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { AiFailedError, AiTimeoutError } from './provider.js';
import type { TicketDraftInput, TicketDraftProvider } from './ticket-draft.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const word = () =>
  `zq${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;

/** A fake that records what it was given and answers with `answer(request)`. */
function capturing(
  answer: (request: TicketDraftInput) => { reply: string; sourceIds: string[] },
): TicketDraftProvider & { calls: TicketDraftInput[] } {
  const calls: TicketDraftInput[] = [];
  return {
    calls,
    async draft(request) {
      calls.push(request);
      return { ...answer(request), usage: { promptTokens: 10, completionTokens: 5 } };
    },
  };
}

describe('POST /api/tickets/:id/ai-draft', () => {
  const echo = capturing((r) => ({
    // Cites everything it was given, in reverse, plus an unknown id; names another client.
    reply: `Dobrý deň ${r.ticket.requesterFirstName}, <@someone> ako pre Obec Horná Lehota a pána Nováka.`,
    sourceIds: [...r.similarTickets.map((t) => t.id), ...r.knowledge.map((k) => k.id), 'zz'],
  }));
  const logLines: Record<string, unknown>[] = [];
  const logStream = { write: (line: string) => void logLines.push(JSON.parse(line)) };
  let test: TestApp;
  let limited: TestApp;
  let off: TestApp;
  let failing: TestApp;
  const admins: string[] = [];
  let failure: Error = new AiFailedError('OpenAI answered 500');

  beforeAll(async () => {
    [test, limited, off, failing] = await Promise.all([
      buildTestApp({ ticketDraft: echo }),
      buildTestApp({
        ticketDraft: capturing(() => ({ reply: 'Ok', sourceIds: [] })),
        config: { aiBurstLimits: { ticketDraftPerMinute: 2 } },
      }),
      buildTestApp(),
      buildTestApp({
        ticketDraft: {
          draft: async () => {
            throw failure;
          },
        },
        logStream,
      }),
    ]);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    for (const t of [test, limited, off, failing]) await t.app.close();
    await Promise.all([test, limited, off, failing].map((t) => t.close()));
  });

  const db = () => test.deps.db;
  const draft = (app: TestApp, ticketId: string, cookie: string, payload: object = {}) =>
    app.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/ai-draft`,
      headers: { cookie },
      payload,
    });

  async function adminOf(app: TestApp) {
    const email = newEmail();
    const a = await addAdmin(app.deps.db, { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(app.app, email) };
  }
  async function member(app: TestApp, groupId: string, role: 'client' | 'ziadatel', name: string) {
    const c = await createUnverifiedClient(app.deps.db, newEmail());
    await app.deps.db.update(user).set({ name }).where(eq(user.id, c.id));
    await addMembership(app.deps.db, c.id, groupId, role);
    return { ...c, cookie: await loginAs(app.app, c.email) };
  }
  async function ticket(over: Partial<typeof tickets.$inferInsert>) {
    const id = randomUUID();
    const now = new Date();
    const [row] = await db()
      .insert(tickets)
      .values({
        id,
        groupId: null,
        status: 'new',
        source: 'manual',
        createdAt: now,
        updatedAt: now,
        ...over,
      })
      .returning();
    return row!;
  }

  /** A ticket of client A, a matching note of A and a resolved ticket of client B. */
  async function scene() {
    const w = word();
    const host = () => `https://a${randomUUID().replaceAll('-', '')}.egrant.sk`;
    const a = await createGroup(db(), { name: 'Firma Alfa', egrantUrl: host() });
    const b = await createGroup(db(), { name: 'Obec Horná Lehota', egrantUrl: host() });
    const admin = await adminOf(test);
    const client = await member(test, a.id, 'client', 'Klára Alfová');
    const ziadatel = await member(test, a.id, 'ziadatel', 'Žofia Žiadateľová');
    const noteId = (
      await createItem(
        { db: db() },
        { id: admin.id, email: admin.email, name: 'Ad Min', role: 'admin', finance: false },
        a.id,
        {
          type: 'note',
          title: `Postup ${w}`,
          body: 'Krok 1',
          visibility: 'public',
          fileIds: [],
          folderId: null,
        },
      )
    ).item.id;
    const other = await ticket({
      groupId: b.id,
      status: 'resolved',
      resolvedAt: new Date(),
      subject: `Rozpočet ${w}`,
      body: 'Ján Novák',
      requesterName: 'Ján Novák',
    });
    const current = await ticket({
      groupId: a.id,
      subject: `Otázka ${w}`,
      body: 'Ako ďalej?',
      requesterName: 'Klára Alfová',
    });
    return { w, a, admin, client, ziadatel, noteId, other, current };
  }

  it('returns the reply and the cited sources in the model order', async () => {
    const s = await scene();
    const res = await draft(test, s.current.id, s.admin.cookie, { instructions: 'Stručne' });
    expect(res.statusCode).toBe(200);
    const body = TicketDraftSchema.parse(res.json());
    expect(body.sources.map((x) => x.id)).toEqual([s.other.id, s.noteId]);
    expect(body.sources[0]).toEqual({
      kind: 'ticket',
      id: s.other.id,
      number: s.other.number,
      subject: s.other.subject,
    });
    expect(body.sources[1]).toEqual({
      kind: 'knowledge',
      id: s.noteId,
      type: 'note',
      title: `Postup ${s.w}`,
      fromAdminGroup: false,
    });
    expect(echo.calls.at(-1)!.instructions).toBe('Stručne');
    expect(body.reply).toContain('Dobrý deň Klára');
    expect(body.reply).not.toContain('<@');
  });

  it("never returns another client's identity", async () => {
    const s = await scene();
    const body = (await draft(test, s.current.id, s.admin.cookie)).json<{ reply: string }>();
    expect(body.reply).not.toMatch(/Lehota|Novák/);
    expect(JSON.stringify(echo.calls.at(-1))).not.toMatch(/Lehota|Novák/);
  });

  it('answers 403 to a client and a ziadatel before the lookup', async () => {
    const s = await scene();
    for (const cookie of [s.client.cookie, s.ziadatel.cookie]) {
      for (const id of [s.current.id, randomUUID(), 'bad']) {
        const res = await draft(test, id, cookie);
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'forbidden' });
      }
    }
  });

  it('answers 404 for a missing ticket and a malformed id', async () => {
    const admin = await adminOf(test);
    expect((await draft(test, randomUUID(), admin.cookie)).statusCode).toBe(404);
    expect((await draft(test, 'not an id', admin.cookie)).statusCode).toBe(404);
  });

  it('answers 400 for instructions over 1000 characters', async () => {
    const s = await scene();
    const res = await draft(test, s.current.id, s.admin.cookie, { instructions: 'x'.repeat(1001) });
    expect(res.statusCode).toBe(400);
  });

  it('answers 503 when the AI is off, and the status says so', async () => {
    const s = await scene();
    const admin = await adminOf(off);
    expect((await draft(off, s.current.id, admin.cookie)).statusCode).toBe(503);
    const status = AiStatusSchema.parse(
      (await off.app.inject({ url: '/api/ai/status', headers: { cookie: admin.cookie } })).json(),
    );
    expect(status.ticketDraft).toBe(false);
    const on = AiStatusSchema.parse(
      (
        await test.app.inject({ url: '/api/ai/status', headers: { cookie: s.admin.cookie } })
      ).json(),
    );
    expect(on.ticketDraft).toBe(true);
  });

  it('answers 502 on a provider failure and a timeout, logged without the texts', async () => {
    const s = await scene();
    const admin = await adminOf(failing);
    for (const [error, outcome] of [
      [new AiFailedError('OpenAI answered 500'), 'failed'],
      [new AiTimeoutError(), 'timeout'],
    ] as const) {
      failure = error;
      logLines.length = 0;
      const res = await draft(failing, s.current.id, admin.cookie, { instructions: 'tajné' });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'ai_failed' });
      const line = logLines.find((l) => l.msg === 'ai ticket draft');
      expect(line?.ai).toMatchObject({ userId: admin.id, ticketId: s.current.id, outcome });
      expect(JSON.stringify(logLines)).not.toContain('tajné');
      expect(JSON.stringify(logLines)).not.toContain(s.w);
    }
  });

  it('answers 429 over the per-minute limit, without calling the provider', async () => {
    const s = await scene();
    const admin = await adminOf(limited);
    const codes = [];
    for (let i = 0; i < 3; i++)
      codes.push((await draft(limited, s.current.id, admin.cookie)).statusCode);
    expect(codes).toEqual([200, 200, 429]);
    expect((limited.deps.ticketDraft as unknown as { calls: unknown[] }).calls).toHaveLength(2);
  });

  it('writes nothing', async () => {
    const s = await scene();
    const channel = await ensureTicketChannel(db(), { id: s.current.id, groupId: s.a.id });
    await db()
      .insert(messages)
      .values({
        id: randomUUID(),
        channelId: channel.id,
        authorId: s.client.id,
        body: `Prosím ${s.w}`,
        clientId: randomUUID(),
        changeSeq: 1,
      });
    const counts = async () => {
      const [m] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(eq(messages.channelId, channel.id));
      const [n] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(notificationEvents)
        .where(inArray(notificationEvents.userId, [s.admin.id, s.client.id]));
      return [m!.n, n!.n];
    };
    const before = await counts();
    expect((await draft(test, s.current.id, s.admin.cookie)).statusCode).toBe(200);
    expect(await counts()).toEqual(before);
  });
});
