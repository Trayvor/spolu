import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { CLAUDE_NOTES_MAX, ClaudePromptSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createFile } from '../files/service.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';

/** Phase 29: POST /api/tickets/:id/claude-prompt and POST /api/tasks/:id/claude-prompt. */

const KEY = 'test-claude-prompt-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `c${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('Open in Claude (Phase 29)', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function group() {
    const h = host();
    const g = await createGroup(db(), { name: 'Supermesto', egrantUrl: `https://${h}.egrant.sk` });
    return { ...g, host: h };
  }
  async function admin(language: 'sk' | 'uk' = 'sk') {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    await db().update(user).set({ language }).where(eq(user.id, a.id));
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel', name: string) {
    const c = await createUnverifiedClient(db(), newEmail());
    await db().update(user).set({ name }).where(eq(user.id, c.id));
    await addMembership(db(), c.id, groupId, role);
    return { ...c, name, cookie: await loginAs(test.app, c.email) };
  }
  async function intake(fields: Record<string, unknown>) {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: fields,
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string; number: number }>();
  }
  async function file(groupId: string, uploadedBy: string, name: string) {
    return createFile(
      { db: db(), storage: test.deps.storage },
      {
        groupId,
        uploadedBy,
        name,
        declaredType: 'text/plain',
        body: Readable.from([Buffer.from('x')]),
      },
    );
  }
  async function send(channelId: string, cookie: string, body: string, fileIds: string[] = []) {
    const res = await call('POST', `/api/channels/${channelId}/messages`, cookie, {
      body,
      fileIds,
      clientId: randomUUID(),
    });
    expect(res.statusCode).toBe(201);
  }
  const generate = async (url: string, cookie: string, payload: object = {}) => {
    const res = await call('POST', url, cookie, payload);
    expect(res.statusCode, res.body).toBe(200);
    return ClaudePromptSchema.parse(res.json());
  };

  it('builds a ticket prompt for an admin: fields, chat with files, instance and MCP steps', async () => {
    const g = await group();
    const a = await admin('uk');
    const anna = await member(g.id, 'client', 'Anna Klientová');
    const t = await intake({
      subject: 'Nejde odoslať žiadosť',
      body: 'Pri odoslaní vidím chybu 500.',
      requester_name: 'Ján Žiadateľ',
      email: 'jan@example.com',
      phone: '+421900000000',
      area: 'Žiadosti',
      programme: 'Kultúra 2026',
      due_date: '2026-11-20',
      url: `https://${g.host}.egrant.sk/application/42`,
      instance_url: `https://${g.host}.egrant.sk/`,
    });
    const chat = (await call('GET', `/api/tickets/${t.id}/chat`, a.cookie)).json<{ id: string }>();
    const log = await file(g.id, anna.id, 'chyba-log.txt');
    await send(chat.id, anna.cookie, 'Posielam log.', [log.id]);
    await send(chat.id, a.cookie, 'Ďakujem, pozriem.');

    const { prompt: p, files } = await generate(`/api/tickets/${t.id}/claude-prompt`, a.cookie, {
      notes: 'Over najmä termíny programu.',
    });
    expect(files).toEqual([{ id: log.id, name: 'chyba-log.txt' }]);
    expect(p).toContain('Over najmä termíny programu.');
    expect(p).toContain(`# Tiket #${t.number}: Nejde odoslať žiadosť`);
    expect(p).toContain(`/tickets/${t.id}`);
    expect(p).toContain('- Stav: Nový');
    expect(p).toContain('- Klient: Supermesto');
    expect(p).toContain('- Oblasť: Žiadosti');
    expect(p).toContain('- Program: Kultúra 2026');
    expect(p).toContain('- Termín: 2026-11-20');
    expect(p).toContain('- Žiadateľ: Ján Žiadateľ <jan@example.com>');
    expect(p).not.toContain('+421900000000');
    expect(p).toContain(
      `- Stránka, ktorej sa tiket týka: https://${g.host}.egrant.sk/application/42`,
    );
    expect(p).toContain('Pri odoslaní vidím chybu 500.');
    expect(p).toMatch(/\] Anna Klientová: Posielam log\.\n {2}\(súbory: chyba-log\.txt\)/);
    expect(p).toContain('] Ad Min: Ďakujem, pozriem.');
    expect(p.indexOf('Posielam log.')).toBeLessThan(p.indexOf('Ďakujem, pozriem.'));
    expect(p).toContain(`https://${g.host}.egrant.sk (hostname: ${g.host}.egrant.sk)`);
    expect(p).toContain('admin_instance_call_write');
    expect(p).toContain('Odpovedaj po ukrajinsky.');
    expect(p).toMatch(
      new RegExp(
        `Vygeneroval: Ad Min <${a.email.replace('.', '\\.')}> \\(admin, Help by eGrant\\), \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d`,
      ),
    );
  });

  it('states the authenticated actor as the author, never a name from the request body', async () => {
    const a = await admin();
    const other = await admin();
    const t = await intake({ subject: 'Autor', body: 'Text' });
    const res = await call('POST', `/api/tickets/${t.id}/claude-prompt`, a.cookie, {
      notes: 'x',
      generatedBy: { name: 'Mallory', email: 'mallory@evil.sk', role: 'superadmin' },
      name: 'Mallory',
    });
    const { prompt: p } = ClaudePromptSchema.parse(res.json());
    expect(res.statusCode).toBe(200);
    expect(p).toContain(`Vygeneroval: Ad Min <${a.email}> (admin, Help by eGrant)`);
    expect(p).not.toContain('Mallory');
    expect(p).not.toContain(other.email);
  });

  it('builds a prompt for a ticket without a client, the instance unknown', async () => {
    const a = await admin();
    const t = await intake({ subject: 'Bez klienta', body: 'Text' });
    const { prompt: p, files } = await generate(`/api/tickets/${t.id}/claude-prompt`, a.cookie);
    expect(files).toEqual([]);
    expect(p).not.toContain('Poznámky administrátora');
    expect(p).toContain('- Klient: bez klienta');
    expect(p).toContain('Inštancia eGrant nie je známa');
    expect(p).toContain('(v chate nie sú žiadne správy)');
  });

  it('builds a task prompt: bucket, assignees, description, files, task chat, group instance', async () => {
    const g = await group();
    const a = await admin();
    const anna = await member(g.id, 'client', 'Anna Klientová');
    const spec = await file(g.id, a.id, 'zadanie.pdf');
    const created = await call('POST', `/api/groups/${g.id}/tasks`, a.cookie, {
      title: 'Upraviť formulár',
      description: 'Pridať pole IČO.',
      assigneeIds: [anna.id],
      dueDate: '2026-12-01',
      urgent: true,
      fileIds: [spec.id],
      link: null,
    });
    expect(created.statusCode, created.body).toBe(201);
    const task = created.json<{ id: string }>();
    const chat = (await call('GET', `/api/tasks/${task.id}/chat`, a.cookie)).json<{ id: string }>();
    await send(chat.id, a.cookie, `Prosím <@${anna.id}> o kontrolu.`);

    const { prompt: p, files } = await generate(`/api/tasks/${task.id}/claude-prompt`, a.cookie);
    expect(files).toEqual([{ id: spec.id, name: 'zadanie.pdf' }]);
    expect(p).toContain('túto úlohu');
    expect(p).toContain('# Úloha: Upraviť formulár');
    expect(p).toContain(`/groups/${g.id}/tasks/${task.id}`);
    expect(p).toContain('- Stĺpec: Na spracovanie');
    expect(p).toContain('- Klient: Supermesto');
    expect(p).toContain('- Urgentná: áno');
    expect(p).toContain('- Termín: 2026-12-01');
    expect(p).toContain('- Riešitelia: Anna Klientová');
    expect(p).toContain('- Vytvoril: Ad Min');
    expect(p).toContain('Pridať pole IČO.');
    expect(p).toContain('- zadanie.pdf');
    expect(p).toContain('] Ad Min: Prosím @Anna Klientová o kontrolu.');
    expect(p).toContain(`Vygeneroval: Ad Min <${a.email}> (admin, Help by eGrant)`);
    expect(p).toContain(`https://${g.host}.egrant.sk (hostname: ${g.host}.egrant.sk)`);
  });

  it('answers 401, 403 for clients and ziadatelia, 404 for an unknown id, 400 for long notes', async () => {
    const g = await group();
    const a = await admin();
    const client = await member(g.id, 'client', 'Klient');
    const ziadatel = await member(g.id, 'ziadatel', 'Žiadateľ');
    const t = await intake({
      subject: 'S',
      body: 'B',
      instance_url: `https://${g.host}.egrant.sk`,
    });
    const task = (
      await call('POST', `/api/groups/${g.id}/tasks`, a.cookie, {
        title: 'T',
        description: '',
        assigneeIds: [],
        dueDate: null,
        urgent: false,
        fileIds: [],
        link: null,
      })
    ).json<{ id: string }>();
    for (const url of [
      `/api/tickets/${t.id}/claude-prompt`,
      `/api/tasks/${task.id}/claude-prompt`,
    ]) {
      expect((await test.app.inject({ method: 'POST', url })).statusCode).toBe(401);
      expect((await call('POST', url, client.cookie, {})).statusCode).toBe(403);
      expect((await call('POST', url, ziadatel.cookie, {})).statusCode).toBe(403);
      const long = await call('POST', url, a.cookie, { notes: 'x'.repeat(CLAUDE_NOTES_MAX + 1) });
      expect(long.statusCode).toBe(400);
    }
    expect((await call('POST', '/api/tickets/nope/claude-prompt', a.cookie, {})).statusCode).toBe(
      404,
    );
    expect((await call('POST', '/api/tasks/nope/claude-prompt', a.cookie, {})).statusCode).toBe(
      404,
    );
    // A client cannot tell a real id from an unknown one.
    expect(
      (await call('POST', '/api/tickets/nope/claude-prompt', client.cookie, {})).statusCode,
    ).toBe(403);
  });
});
