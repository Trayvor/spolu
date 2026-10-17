import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import {
  FinanceEvents,
  type FileInfo,
  type FinanceFolder,
  type FinanceItemDetail,
  type FinanceItemPage,
  type FinancePerson,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { files } from '../files/schema.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser, setFinanceAccess } from '../users/service.js';
import { listItems } from './documents.js';

/**
 * Part B (spec §6.1, §7): the Documents card's routes. Every route sits behind `requireFinance`;
 * items, folders and files of a client are reachable only by finance admins.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Session = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;

describe('finance documents (part B)', () => {
  let test: TestApp;
  let fin: Session;
  let fin2: Session;
  let plain: Session;
  const admins: string[] = [];

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function adminSession(finance: boolean): Promise<Session> {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name: finance ? 'Fina' : 'Plain' });
    admins.push(admin.id);
    if (finance) await setFinanceAccess(test.deps.db, admin.id, admin.id);
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }
  async function clientIn(groupId: string): Promise<Session> {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'Client', role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }
  const newGroup = () =>
    createGroup(test.deps.db, {
      name: `Firma ${randomUUID().slice(0, 6)}`,
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });

  const contract = (extra: object = {}) => ({
    type: 'contract',
    title: 'Zmluva o dielo',
    contractNumber: 'Z-2026/01',
    amount: { amountMinor: 1_200_000, currency: 'EUR' },
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
    ...extra,
  });
  async function createItem(groupId: string, body: object, cookie = fin.cookie) {
    const res = await call('POST', `/api/groups/${groupId}/finance/items`, cookie, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<FinanceItemDetail>();
  }
  async function financeUpload(groupId: string, cookie = fin.cookie, name = 'zmluva.pdf') {
    const res = await test.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/finance/files`,
      headers: {
        cookie,
        'content-type': 'application/pdf',
        'x-file-name': encodeURIComponent(name),
      },
      payload: Buffer.from('%PDF-1.4 12 000 EUR'),
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<FileInfo>();
  }
  const page = async (groupId: string, query = '') => {
    const res = await call('GET', `/api/groups/${groupId}/finance/items${query}`, fin.cookie);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<FinanceItemPage>();
  };

  beforeAll(async () => {
    test = await buildTestApp();
    [fin, fin2, plain] = await Promise.all([
      adminSession(true),
      adminSession(true),
      adminSession(false),
    ]);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  describe('access', () => {
    it('every route answers 401 without a session and 403 to a client or an admin without the right', async () => {
      const g = await newGroup();
      const client = await clientIn(g.id);
      const item = await createItem(g.id, { type: 'note', title: 'Poznámka' });
      const folder = (
        await call('POST', `/api/groups/${g.id}/finance/folders`, fin.cookie, { name: 'Zmluvy' })
      ).json<FinanceFolder>();
      const routes: [Parameters<typeof call>[0], string, object?][] = [
        ['GET', `/api/groups/${g.id}/finance/items`],
        ['GET', `/api/groups/${g.id}/finance/folders`],
        ['POST', `/api/groups/${g.id}/finance/items`, { type: 'note', title: 'x' }],
        ['GET', `/api/finance/items/${item.id}`],
        ['PATCH', `/api/finance/items/${item.id}`, { updatedAt: item.updatedAt, title: 'y' }],
        ['DELETE', `/api/finance/items/${item.id}`],
        ['POST', `/api/groups/${g.id}/finance/folders`, { name: 'x' }],
        ['PATCH', `/api/finance/folders/${folder.id}`, { name: 'y' }],
        ['DELETE', `/api/finance/folders/${folder.id}`],
        ['POST', `/api/groups/${g.id}/finance/files`],
        ['GET', '/api/finance/recipients'],
      ];
      for (const [method, url, payload] of routes) {
        const anon = await test.app.inject({ method, url, ...(payload ? { payload } : {}) });
        expect({ url, method, code: anon.statusCode }).toEqual({ url, method, code: 401 });
        for (const who of [plain, client]) {
          const res = await call(method, url, who.cookie, payload);
          expect({ url, method, code: res.statusCode }).toEqual({ url, method, code: 403 });
        }
      }
      // Nothing changed.
      expect((await call('GET', `/api/finance/items/${item.id}`, fin.cookie)).statusCode).toBe(200);
    });

    it('an unknown group, item or folder is 404 for a finance admin', async () => {
      const id = randomUUID();
      expect((await call('GET', `/api/groups/${id}/finance/items`, fin.cookie)).statusCode).toBe(
        404,
      );
      expect(
        (
          await call('POST', `/api/groups/${id}/finance/items`, fin.cookie, {
            type: 'note',
            title: 'x',
          })
        ).statusCode,
      ).toBe(404);
      expect((await call('GET', `/api/finance/items/${id}`, fin.cookie)).statusCode).toBe(404);
      expect(
        (await call('PATCH', `/api/finance/folders/${id}`, fin.cookie, { name: 'x' })).statusCode,
      ).toBe(404);
    });
  });

  describe('items', () => {
    it('creates, reads, edits and deletes a contract, a document and a note', async () => {
      const g = await newGroup();
      const created = await createItem(g.id, contract({ body: 'Platba **vopred**' }));
      expect(created).toMatchObject({
        groupId: g.id,
        type: 'contract',
        title: 'Zmluva o dielo',
        folderId: null,
        body: 'Platba **vopred**',
        contract: {
          contractNumber: 'Z-2026/01',
          amount: { amountMinor: 1_200_000, currency: 'EUR' },
          startsOn: '2026-01-01',
          endsOn: '2026-12-31',
        },
        fileCount: 0,
        files: [],
        hasUpcomingReminder: false,
        createdBy: fin.id,
        createdByName: 'Fina',
      });
      const doc = await createItem(g.id, { type: 'document', title: 'Výpis z OR' });
      const note = await createItem(g.id, { type: 'note', title: 'Poznámka', body: 'text' });
      expect(doc.contract).toBeNull();
      expect(note.body).toBe('text');

      // Another finance admin edits it.
      const patched = await call('PATCH', `/api/finance/items/${created.id}`, fin2.cookie, {
        updatedAt: created.updatedAt,
        title: 'Zmluva o dielo 2026',
        amount: { amountMinor: 1_500_000, currency: 'EUR' },
        endsOn: '2027-01-31',
        contractNumber: '',
      });
      expect(patched.statusCode, patched.body).toBe(200);
      expect(patched.json<FinanceItemDetail>()).toMatchObject({
        title: 'Zmluva o dielo 2026',
        contract: {
          contractNumber: null,
          amount: { amountMinor: 1_500_000 },
          startsOn: '2026-01-01',
          endsOn: '2027-01-31',
        },
      });

      // A stale `updatedAt` is a conflict.
      const stale = await call('PATCH', `/api/finance/items/${created.id}`, fin.cookie, {
        updatedAt: created.updatedAt,
        title: 'Old view',
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toEqual({ error: 'finance_changed' });

      expect((await call('DELETE', `/api/finance/items/${doc.id}`, fin.cookie)).statusCode).toBe(
        204,
      );
      expect((await call('GET', `/api/finance/items/${doc.id}`, fin.cookie)).statusCode).toBe(404);
    });

    it('checks a contract: its amount, its period, an enabled currency; other types have none', async () => {
      const g = await newGroup();
      const url = `/api/groups/${g.id}/finance/items`;
      const bad = [
        contract({ amount: undefined }),
        contract({ startsOn: undefined }),
        contract({ endsOn: '2025-12-31' }),
        contract({ amount: { amountMinor: 100, currency: 'UAH' } }),
        contract({ amount: { amountMinor: -1, currency: 'EUR' } }),
        contract({ startsOn: '2026-02-30' }),
        { type: 'document', title: 'Doc', amount: { amountMinor: 1, currency: 'EUR' } },
        { type: 'note', title: '' },
        { type: 'folder', title: 'x' },
      ];
      for (const body of bad) {
        const res = await call('POST', url, fin.cookie, body);
        expect({ body, code: res.statusCode }).toEqual({ body, code: 400 });
      }
      const item = await createItem(g.id, contract());
      const doc = await createItem(g.id, { type: 'document', title: 'Doc' });
      const patches: [string, object][] = [
        [item.id, { endsOn: '2025-06-30' }],
        [item.id, { startsOn: '2027-01-01' }],
        [item.id, { amount: { amountMinor: 5, currency: 'UAH' } }],
        [doc.id, { amount: { amountMinor: 5, currency: 'EUR' } }],
        [doc.id, { contractNumber: 'X' }],
        [doc.id, { startsOn: '2026-01-01' }],
      ];
      for (const [id, patch] of patches) {
        const updatedAt = id === item.id ? item.updatedAt : doc.updatedAt;
        const res = await call('PATCH', `/api/finance/items/${id}`, fin.cookie, {
          updatedAt,
          ...patch,
        });
        expect({ patch, code: res.statusCode }).toEqual({ patch, code: 400 });
      }
    });

    it('lists newest first, 30 a page, with the type filter and the folder', async () => {
      const g = await newGroup();
      const ids: string[] = [];
      for (let i = 0; i < 31; i++) {
        ids.push((await createItem(g.id, { type: 'document', title: `Doc ${i}` })).id);
      }
      const c = await createItem(g.id, contract());
      const first = await page(g.id);
      expect(first.items).toHaveLength(30);
      expect(first.items[0]!.id).toBe(c.id);
      expect(first.nextCursor).not.toBeNull();
      const second = await page(g.id, `?after=${encodeURIComponent(first.nextCursor!)}`);
      expect(second.items.map((i) => i.id)).toEqual([ids[1], ids[0]]);
      expect(second.nextCursor).toBeNull();
      // The type filter lists across folders.
      const contracts = await page(g.id, '?type=contract');
      expect(contracts.items.map((i) => i.id)).toEqual([c.id]);
      expect(contracts.items[0]!.folderPath).toEqual([]);
      // A bad cursor is a validation error.
      expect(
        (await call('GET', `/api/groups/${g.id}/finance/items?after=nonsense`, fin.cookie))
          .statusCode,
      ).toBe(400);
    });

    it('searches title, number, body and file names without diacritics, across folders', async () => {
      const g = await newGroup();
      const folder = (
        await call('POST', `/api/groups/${g.id}/finance/folders`, fin.cookie, { name: 'Rok 2026' })
      ).json<FinanceFolder>();
      const file = await financeUpload(g.id, fin.cookie, 'Príloha-č1.pdf');
      const a = await createItem(
        g.id,
        contract({ title: 'Údržba webu', folderId: folder.id, fileIds: [file.id] }),
      );
      const b = await createItem(g.id, { type: 'note', title: 'Iné', body: 'Rozpočet na údržbu' });
      await createItem(g.id, { type: 'note', title: 'Nič' });
      const found = await page(g.id, '?q=udrzb');
      expect(found.items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
      expect(found.items.find((i) => i.id === a.id)!.folderPath).toEqual(['Rok 2026']);
      expect((await page(g.id, '?q=z-2026')).items.map((i) => i.id)).toEqual([a.id]);
      expect((await page(g.id, '?q=priloha')).items.map((i) => i.id)).toEqual([a.id]);
      // The root lists only items in no folder.
      expect((await page(g.id)).items.map((i) => i.id)).not.toContain(a.id);
      expect((await page(g.id, `?folder=${folder.id}`)).items.map((i) => i.id)).toEqual([a.id]);
    });

    it('listItems serves the other scopes and sorts contracts (part D)', async () => {
      const g1 = await newGroup();
      const g2 = await newGroup();
      const a = await createItem(g1.id, contract({ startsOn: '2026-03-01', endsOn: '2026-04-01' }));
      const b = await createItem(
        g2.id,
        contract({ amount: { amountMinor: 5, currency: 'EUR' }, startsOn: '2026-05-01' }),
      );
      await createItem(g2.id, { type: 'note', title: 'note' });
      const both = await listItems(
        test.deps.db,
        { kind: 'groups', groupIds: [g1.id, g2.id] },
        { type: 'contract', sort: 'start' },
      );
      expect(both.items.map((i) => i.id)).toEqual([b.id, a.id]);
      const byAmount = await listItems(
        test.deps.db,
        { kind: 'groups', groupIds: [g1.id, g2.id] },
        { type: 'contract', sort: 'amount', dir: 'asc' },
      );
      expect(byAmount.items.map((i) => i.id)).toEqual([b.id, a.id]);
      const byEnd = await listItems(
        test.deps.db,
        { kind: 'groups', groupIds: [g1.id, g2.id] },
        { type: 'contract', sort: 'end', dir: 'asc' },
      );
      expect(byEnd.items.map((i) => i.id)).toEqual([a.id, b.id]);
      // Paging by a sort key: one a page.
      const one = await listItems(
        test.deps.db,
        { kind: 'groups', groupIds: [g1.id, g2.id] },
        { type: 'contract', sort: 'start', limit: 1 },
      );
      expect(one.items.map((i) => i.id)).toEqual([b.id]);
      const next = await listItems(
        test.deps.db,
        { kind: 'groups', groupIds: [g1.id, g2.id] },
        { type: 'contract', sort: 'start', limit: 1, after: one.nextCursor! },
      );
      expect(next.items.map((i) => i.id)).toEqual([a.id]);
      expect((await listItems(test.deps.db, { kind: 'groups', groupIds: [] }, {})).items).toEqual(
        [],
      );
    });
  });

  describe('folders', () => {
    it('nests, renames, refuses a cycle, and deleting moves the contents up', async () => {
      const g = await newGroup();
      const make = async (name: string, parentId: string | null = null) => {
        const res = await call('POST', `/api/groups/${g.id}/finance/folders`, fin.cookie, {
          name,
          parentId,
        });
        expect(res.statusCode, res.body).toBe(201);
        return res.json<FinanceFolder>();
      };
      const top = await make('Zmluvy');
      const child = await make('2026', top.id);
      const grand = await make('Q1', child.id);
      const item = await createItem(g.id, { type: 'note', title: 'In child', folderId: child.id });

      const renamed = await call('PATCH', `/api/finance/folders/${top.id}`, fin.cookie, {
        name: 'Všetky zmluvy',
      });
      expect(renamed.json<FinanceFolder>().name).toBe('Všetky zmluvy');

      for (const parentId of [top.id, grand.id]) {
        const res = await call('PATCH', `/api/finance/folders/${top.id}`, fin.cookie, { parentId });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'invalid_folder' });
      }

      // A folder of another client is not found.
      const other = await newGroup();
      const res = await call('POST', `/api/groups/${other.id}/finance/items`, fin.cookie, {
        type: 'note',
        title: 'x',
        folderId: top.id,
      });
      expect(res.statusCode).toBe(404);

      expect(
        (await call('DELETE', `/api/finance/folders/${child.id}`, fin.cookie)).statusCode,
      ).toBe(204);
      const folders = (await call('GET', `/api/groups/${g.id}/finance/folders`, fin.cookie)).json<
        FinanceFolder[]
      >();
      expect(folders.map((f) => [f.name, f.parentId])).toEqual([
        ['Q1', top.id],
        ['Všetky zmluvy', null],
      ]);
      const moved = (
        await call('GET', `/api/finance/items/${item.id}`, fin.cookie)
      ).json<FinanceItemDetail>();
      expect(moved.folderId).toBe(top.id);
    });

    it('moves an item into a folder and back to the top', async () => {
      const g = await newGroup();
      const folder = (
        await call('POST', `/api/groups/${g.id}/finance/folders`, fin.cookie, { name: 'A' })
      ).json<FinanceFolder>();
      const item = await createItem(g.id, { type: 'note', title: 'x' });
      const into = await call('PATCH', `/api/finance/items/${item.id}`, fin.cookie, {
        updatedAt: item.updatedAt,
        folderId: folder.id,
      });
      expect(into.json<FinanceItemDetail>().folderId).toBe(folder.id);
      const back = await call('PATCH', `/api/finance/items/${item.id}`, fin.cookie, {
        updatedAt: into.json<FinanceItemDetail>().updatedAt,
        folderId: null,
      });
      expect(back.json<FinanceItemDetail>().folderId).toBeNull();
    });
  });

  describe('finance-only files', () => {
    it('an upload is finance-only, attaches only to a finance item, and opens for finance admins only', async () => {
      const g = await newGroup();
      const client = await clientIn(g.id);
      const file = await financeUpload(g.id);
      const [row] = await test.deps.db.select().from(files).where(eq(files.id, file.id));
      expect(row!.financeOnly).toBe(true);

      const item = await createItem(g.id, contract({ fileIds: [file.id] }));
      expect(item.files.map((f) => f.id)).toEqual([file.id]);
      expect(item.fileCount).toBe(1);
      expect((await call('GET', `/api/files/${file.id}`, fin2.cookie)).statusCode).toBe(200);
      for (const who of [plain, client]) {
        expect((await call('GET', `/api/files/${file.id}`, who.cookie)).statusCode).toBe(404);
      }

      // An ordinary group upload cannot join a finance item.
      const plainFile = (
        await test.app.inject({
          method: 'POST',
          url: `/api/groups/${g.id}/files`,
          headers: { cookie: fin.cookie, 'content-type': 'text/plain', 'x-file-name': 'a.txt' },
          payload: Buffer.from('a'),
        })
      ).json<FileInfo>();
      const res = await call('POST', `/api/groups/${g.id}/finance/items`, fin.cookie, {
        type: 'document',
        title: 'x',
        fileIds: [plainFile.id],
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_attachment' });
    });

    it('a removed file and a deleted item take their files with them', async () => {
      const g = await newGroup();
      const f1 = await financeUpload(g.id);
      const f2 = await financeUpload(g.id);
      const item = await createItem(g.id, {
        type: 'document',
        title: 'x',
        fileIds: [f1.id, f2.id],
      });
      const patched = await call('PATCH', `/api/finance/items/${item.id}`, fin.cookie, {
        updatedAt: item.updatedAt,
        fileIds: [f2.id],
      });
      expect(patched.json<FinanceItemDetail>().files.map((f) => f.id)).toEqual([f2.id]);
      expect(await test.deps.db.select().from(files).where(eq(files.id, f1.id))).toEqual([]);
      await call('DELETE', `/api/finance/items/${item.id}`, fin.cookie);
      expect(await test.deps.db.select().from(files).where(eq(files.id, f2.id))).toEqual([]);
    });
  });

  describe('recipients', () => {
    it('lists the active finance admins only', async () => {
      const res = await call('GET', '/api/finance/recipients', fin.cookie);
      const ids = res.json<FinancePerson[]>().map((p) => p.id);
      expect(ids).toContain(fin.id);
      expect(ids).toContain(fin2.id);
      expect(ids).not.toContain(plain.id);
    });
  });

  describe('live updates', () => {
    it('a write tells the finance room (kind items)', async () => {
      const g = await newGroup();
      await test.app.listen({ port: 0, host: '127.0.0.1' });
      const address = test.app.server.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      const socket: Socket = connect(`http://127.0.0.1:${address.port}`, {
        transports: ['websocket'],
        extraHeaders: { cookie: fin2.cookie },
        reconnection: false,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once('connect', () => resolve());
          socket.once('connect_error', reject);
        });
        const got = new Promise((resolve) => socket.once(FinanceEvents.changed, resolve));
        await createItem(g.id, { type: 'note', title: 'live' });
        expect(await got).toEqual({ groupId: g.id, kind: 'items' });
      } finally {
        socket.close();
      }
    });
  });
});
