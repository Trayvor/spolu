import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileInfo } from '@spolu/shared';
import { insertTask } from '../../../test/tasks.js';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, deactivateUser, setFinanceAccess } from '../users/service.js';

/**
 * The leak guarantees of part B (spec §2.3): a contract, its number and its files never show in
 * the knowledge tab, the global knowledge list and search, the chat's knowledge picker or the
 * "Open in Claude" prompt, and no module but finance (and the reminders' foreign key) names a
 * finance table.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const FINANCE_TABLES =
  /finance_items|finance_folders|finance_attachments|finance_contract_shares|financeItems|financeFolders|financeAttachments|financeContractShares/;
/** Files outside `modules/finance` that may name a finance table (with why). */
const ALLOWED = new Set([
  // The foreign key `reminder_sets.finance_item_id` (part A1).
  'modules/reminders/schema.ts',
]);

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'migrations') out.push(...(await sourceFiles(path)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

describe('finance leak guarantees (B)', () => {
  let test: TestApp;
  let fin: { id: string; cookie: string };
  const admins: string[] = [];
  const word = `Tajne${randomUUID().slice(0, 8)}`;
  let groupId: string;

  const get = (url: string, cookie: string) =>
    test.app.inject({ method: 'GET', url, headers: { cookie } });

  beforeAll(async () => {
    test = await buildTestApp();
    const email = `${randomUUID()}@example.com`;
    const admin = await addAdmin(test.deps.db, { email, name: 'Fina' });
    admins.push(admin.id);
    await setFinanceAccess(test.deps.db, admin.id, admin.id);
    fin = { id: admin.id, cookie: await loginAs(test.app, email) };
    const g = await createGroup(test.deps.db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    groupId = g.id;
    const upload = await test.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/finance/files`,
      headers: {
        cookie: fin.cookie,
        'content-type': 'application/pdf',
        'x-file-name': `${word}.pdf`,
      },
      payload: Buffer.from('%PDF-1.4'),
    });
    const file = upload.json<FileInfo>();
    for (const body of [
      {
        type: 'contract',
        title: `${word} zmluva`,
        contractNumber: `${word}-1`,
        body: `${word} 12 000 EUR`,
        amount: { amountMinor: 1_200_000, currency: 'EUR' },
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
        fileIds: [file.id],
      },
      { type: 'note', title: `${word} note`, body: word },
    ]) {
      const res = await test.app.inject({
        method: 'POST',
        url: `/api/groups/${groupId}/finance/items`,
        headers: { cookie: fin.cookie },
        payload: body,
      });
      expect(res.statusCode, res.body).toBe(201);
    }
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  it('the knowledge tab, its search and the chat picker never list a finance item', async () => {
    for (const url of [
      `/api/groups/${groupId}/knowledge`,
      `/api/groups/${groupId}/knowledge?q=${word}`,
      `/api/groups/${groupId}/knowledge?shareable=1&q=${word}`,
      `/api/knowledge?scope=all&q=${word}`,
      `/api/knowledge?clients=${groupId}`,
    ]) {
      const res = await get(url, fin.cookie);
      expect({ url, code: res.statusCode }).toEqual({ url, code: 200 });
      expect({ url, leak: res.body.includes(word) }).toEqual({ url, leak: false });
    }
  });

  it('the "Open in Claude" prompt of the client\'s task holds nothing of finance', async () => {
    const taskId = await insertTask(test.deps.db, { groupId, createdBy: fin.id, title: 'Úloha' });
    const res = await test.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/claude-prompt`,
      headers: { cookie: fin.cookie },
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(word);
  });

  it('no module but finance names a finance table', async () => {
    const offenders: string[] = [];
    for (const path of await sourceFiles(SRC)) {
      const rel = relative(SRC, path).replaceAll('\\', '/');
      if (rel.startsWith('modules/finance/') || ALLOWED.has(rel)) continue;
      if (FINANCE_TABLES.test(await readFile(path, 'utf8'))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
