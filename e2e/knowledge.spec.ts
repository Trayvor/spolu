import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import type {
  KnowledgeFolderDto,
  KnowledgeFolderList,
  KnowledgeItemDto,
  KnowledgePage,
} from '@spolu/shared';
import { withDb } from './db';
import { clearMailFor, latestLoginCode } from './mailpit';
import { fakeSubscription, waitForPush } from './push-log';

// Phase 17 "Done when": an admin (the superadmin) and a client of one group share knowledge
// items, the client never sees admins-only items or their files, reminders push and export to a
// calendar, and the global list finds items by client, types and search. One client logs in once
// (production rate limits allow only a few code requests per minute).
test.describe.serial('knowledge base', () => {
  const stamp = Date.now();
  let groupId = '';
  let adminContext: BrowserContext;
  let clientContext: BrowserContext;
  let clientId = '';
  const endpoint = fakeSubscription();

  const upload = async (request: APIRequestContext, name: string, body: string) => {
    const res = await request.post(`/api/groups/${groupId}/files`, {
      headers: { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent(name) },
      data: Buffer.from(body),
    });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };

  const create = async (request: APIRequestContext, draft: Record<string, unknown>) => {
    const res = await request.post(`/api/groups/${groupId}/knowledge`, { data: draft });
    expect(res.status()).toBe(201);
    return (await res.json()) as KnowledgeItemDto;
  };

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext({ storageState: 'e2e/.auth/superadmin.json' });
    const created = await adminContext.request.post('/api/groups', {
      data: { name: `E2E Znalosti ${stamp}`, egrantUrl: `https://e2e-kb-${stamp}.egrant.sk` },
    });
    groupId = ((await created.json()) as { id: string }).id;

    const admin = await adminContext.newPage();
    await admin.goto(`/groups/${groupId}/members`);
    const inviteUrl = await admin.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();
    await admin.close();

    const email = `e2e-kb-${stamp}@example.com`;
    clientContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
    const client = await clientContext.newPage();
    await client.goto(new URL(inviteUrl).pathname);
    await clearMailFor(clientContext.request, email);
    await client.getByLabel('E-mail').fill(email);
    await client.getByRole('button', { name: 'Poslať kód' }).click();
    await client.getByLabel('Kód').fill(await latestLoginCode(clientContext.request, email));
    await client.getByLabel('Vaše meno').fill('E2E Znalosti Klient');
    await client.getByRole('button', { name: 'Pokračovať' }).click();
    await expect(client).toHaveURL(new RegExp(`/groups/${groupId}/chat$`));
    clientId = ((await (await client.request.get('/api/me')).json()) as { id: string }).id;
    const saved = await client.request.post('/api/push/subscriptions', { data: endpoint });
    expect(saved.status()).toBe(204);
    await client.close();
  });

  test.afterAll(async () => {
    await clientContext?.close();
    await adminContext?.close();
  });

  test('an admins-only note with a file is invisible to the client and its file URL is 404', async () => {
    const fileId = await upload(adminContext.request, `interne-${stamp}.txt`, 'internal');
    const note = await create(adminContext.request, {
      type: 'note',
      title: `Interná poznámka ${stamp}`,
      body: 'Len pre eGrant',
      visibility: 'admins',
      fileIds: [fileId],
    });
    const publicNote = await create(adminContext.request, {
      type: 'note',
      title: `Verejná poznámka ${stamp}`,
      body: 'Pre všetkých',
      visibility: 'public',
      fileIds: [],
    });

    const client = await clientContext.newPage();
    await client.goto(`/groups/${groupId}/knowledge`);
    await expect(client.getByRole('button', { name: `Otvoriť ${publicNote.title}` })).toBeVisible();
    await expect(client.getByText(note.title)).toHaveCount(0);
    expect((await client.request.get(`/api/files/${fileId}`)).status()).toBe(404);
    expect((await client.request.get(`/api/knowledge/${note.id}`)).status()).toBe(404);
    // The admin reads both.
    expect((await adminContext.request.get(`/api/files/${fileId}`)).status()).toBe(200);
    await client.close();
  });

  test("the client's link item appears live for the admin, whose link opens it in a new tab", async () => {
    const admin = await adminContext.newPage();
    await admin.goto(`/groups/${groupId}/knowledge`);
    await expect(admin.getByRole('heading', { name: 'Znalosti', exact: true })).toBeVisible();

    const title = `Portál výzvy ${stamp}`;
    const url = `https://opvai.sk/vyzvy/e2e-${stamp}`;
    await create(clientContext.request, { type: 'link', title, body: '', url, fileIds: [] });

    // No reload: the socket event adds the row.
    await expect(admin.getByRole('button', { name: `Otvoriť ${title}` })).toBeVisible();
    const link = admin.getByRole('link', { name: new RegExp(`opvai\\.sk/vyzvy/e2e-${stamp}`) });
    await expect(link).toHaveAttribute('href', url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await admin.close();
  });

  test('a reminder pushes to the client and its .ics has one VEVENT per upcoming time', async () => {
    test.setTimeout(150_000);
    const soon = new Date(Date.now() + 2 * 60_000).toISOString();
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const reminder = await create(adminContext.request, {
      type: 'reminder',
      title: `Odovzdať správu ${stamp}`,
      body: 'Nahrať podpísané PDF',
      fileIds: [],
      reminder: { times: [{ at: soon }, { at: later }], recipientIds: [clientId] },
    });
    expect(reminder.reminder!.recipients.map((r) => r.user.id)).toContain(clientId);

    const ics = await adminContext.request.get(
      `/api/knowledge/${reminder.id}/reminders/calendar.ics`,
    );
    expect(ics.status()).toBe(200);
    expect(ics.headers()['content-type']).toContain('text/calendar');
    const text = await ics.text();
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text).toContain('\r\n');

    // Move the first time into the past; the every-minute cron fires it.
    const timeId = [...reminder.reminder!.times].sort((a, b) => a.at.localeCompare(b.at))[0]?.id;
    expect(timeId).toBeTruthy();
    await withDb(
      (sql) => sql`update reminder_times set at = now() - interval '1 second' where id = ${timeId}`,
    );
    const push = await waitForPush(
      endpoint.endpoint,
      (p) => p.url.includes(`?k=${reminder.id}`),
      90_000,
    );
    expect(push.url).toBe(`/groups/${groupId}/knowledge?k=${reminder.id}`);

    // The fired time leaves one upcoming VEVENT.
    const after = await (
      await adminContext.request.get(`/api/knowledge/${reminder.id}/reminders/calendar.ics`)
    ).text();
    expect(after.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  test('the global list filters by client and type and finds a file by a diacritics-free fragment', async () => {
    const fileId = await upload(adminContext.request, `rozpočet-${stamp}-final.txt`, 'budget');
    const fileItem = await create(adminContext.request, {
      type: 'file',
      title: `Rozpočet ${stamp}`,
      body: 'Schválená verzia',
      fileIds: [fileId],
    });

    const page = await adminContext.newPage();
    await page.goto(`/knowledge?clients=${groupId}&type=file&q=rozpocet-${stamp}`);
    await expect(page.getByRole('button', { name: `Otvoriť ${fileItem.title}` })).toBeVisible();
    await expect(page.getByText(`E2E Znalosti ${stamp}`).first()).toBeVisible();
    // Another type finds nothing; several types find it when one of them is its type.
    await page.goto(`/knowledge?clients=${groupId}&type=link&q=rozpocet-${stamp}`);
    await expect(page.getByRole('button', { name: `Otvoriť ${fileItem.title}` })).toHaveCount(0);
    await page.goto(`/knowledge?clients=${groupId}&type=link,file&q=rozpocet-${stamp}`);
    await expect(page.getByRole('button', { name: `Otvoriť ${fileItem.title}` })).toBeVisible();
    await expect(page.getByRole('button', { name: '2 typy' })).toBeVisible();

    // The same through the API.
    const res = await adminContext.request.get(
      `/api/knowledge?clients=${groupId}&type=file&q=${encodeURIComponent(`rozpocet-${stamp}`)}`,
    );
    const page1 = (await res.json()) as KnowledgePage;
    expect(page1.items.map((i) => i.id)).toEqual([fileItem.id]);
    const several = await adminContext.request.get(
      `/api/knowledge?clients=${groupId}&type=note,file&q=${encodeURIComponent(`rozpocet-${stamp}`)}`,
    );
    expect(((await several.json()) as KnowledgePage).items.map((i) => i.id)).toEqual([fileItem.id]);
    // Clients cannot use the global list.
    expect((await clientContext.request.get('/api/knowledge')).status()).toBe(403);
    await page.close();
  });

  // Phase 24: folders. The client never sees an admins-only folder or what is in it; a search
  // finds an item in a subfolder and shows its path.
  test('folders: the client sees only public folders, and search shows the folder path', async () => {
    const folder = async (data: Record<string, unknown>) => {
      const res = await adminContext.request.post(`/api/groups/${groupId}/knowledge/folders`, {
        data,
      });
      expect(res.status()).toBe(201);
      return (await res.json()) as KnowledgeFolderDto;
    };
    const grants = await folder({ name: `Granty ${stamp}` });
    const year = await folder({ name: `Rok ${stamp}`, parentId: grants.id });
    const secret = await folder({ name: `Tajné ${stamp}`, visibility: 'admins' });
    const deep = await create(adminContext.request, {
      type: 'note',
      title: `Hlboko ${stamp}`,
      fileIds: [],
      folderId: year.id,
    });
    const hidden = await create(adminContext.request, {
      type: 'note',
      title: `Skryté ${stamp}`,
      fileIds: [],
      folderId: secret.id,
    });
    expect(hidden.visibility).toBe('admins');

    const listed = (await (
      await clientContext.request.get(`/api/groups/${groupId}/knowledge/folders`)
    ).json()) as KnowledgeFolderList;
    expect(listed.folders.map((f) => f.id)).toContain(grants.id);
    expect(listed.folders.map((f) => f.id)).not.toContain(secret.id);
    expect(
      (
        await clientContext.request.get(`/api/groups/${groupId}/knowledge?folder=${secret.id}`)
      ).status(),
    ).toBe(404);

    const client = await clientContext.newPage();
    await client.goto(`/groups/${groupId}/knowledge`);
    await expect(
      client.getByRole('button', { name: `Otvoriť priečinok ${grants.name}` }),
    ).toBeVisible();
    await expect(client.getByText(secret.name)).toHaveCount(0);
    await client.getByRole('button', { name: `Otvoriť priečinok ${grants.name}` }).click();
    await client.getByRole('button', { name: `Otvoriť priečinok ${year.name}` }).click();
    await expect(client.getByRole('button', { name: `Otvoriť ${deep.title}` })).toBeVisible();
    await expect(client.getByRole('navigation', { name: 'Cesta k priečinku' })).toContainText(
      year.name,
    );

    await client.goto(`/groups/${groupId}/knowledge?q=${encodeURIComponent(`Hlboko ${stamp}`)}`);
    await expect(client.getByRole('button', { name: `Otvoriť ${deep.title}` })).toBeVisible();
    await expect(client.getByText(`${grants.name} / ${year.name}`)).toBeVisible();
    await client.goto(`/groups/${groupId}/knowledge?q=${encodeURIComponent(`Skryté ${stamp}`)}`);
    await expect(client.getByRole('button', { name: `Otvoriť ${hidden.title}` })).toHaveCount(0);
    await client.close();

    // The admins' global view: client → folders → items.
    const admin = await adminContext.newPage();
    await admin.goto(`/knowledge?clients=${groupId}`);
    await admin.getByRole('button', { name: `Otvoriť priečinok E2E Znalosti ${stamp}` }).click();
    await expect(
      admin.getByRole('button', { name: `Otvoriť priečinok ${secret.name}` }),
    ).toBeVisible();
    await admin.close();
  });

  test('a file the client sends in the group chat appears under "Z chatu" live and opens the chat', async () => {
    const admin = await adminContext.newPage();
    await admin.goto(`/groups/${groupId}/knowledge`);
    await admin.getByRole('checkbox', { name: 'Z chatu' }).click();
    await expect(admin).toHaveURL(/type=chat_file/);
    // Only shown with "Z chatu".
    await expect(admin.getByRole('checkbox', { name: 'Aj z úloh a tiketov' })).toBeVisible();

    const name = `zmluva-${stamp}.txt`;
    const fileId = await upload(clientContext.request, name, 'zmluva');
    const channel = (await (
      await clientContext.request.get(`/api/groups/${groupId}/chat`)
    ).json()) as {
      id: string;
    };
    const sent = await clientContext.request.post(`/api/channels/${channel.id}/messages`, {
      data: { clientId: `kb-${stamp}`, body: 'Posielam zmluvu', fileIds: [fileId] },
    });
    expect(sent.status()).toBe(201);
    const messageId = ((await sent.json()) as { id: string }).id;

    // Live: the row appears without a reload; the file name downloads, the row opens the chat.
    await expect(admin.getByRole('link', { name, exact: true })).toHaveAttribute(
      'href',
      `/api/files/${fileId}`,
    );
    await expect(admin.getByText('Skupinový chat')).toBeVisible();
    await admin.getByRole('link', { name: `Zobraziť ${name} v chate` }).click();
    await expect(admin).toHaveURL(new RegExp(`/groups/${groupId}/chat`));
    await expect(admin.getByText('Posielam zmluvu')).toBeVisible();

    // The client finds it by search too; deleting the message removes it.
    const found = (await (
      await clientContext.request.get(`/api/groups/${groupId}/knowledge?q=zmluva-${stamp}`)
    ).json()) as KnowledgePage;
    expect(found.items.map((i) => i.title)).toEqual([name]);
    expect((await clientContext.request.delete(`/api/messages/${messageId}`)).status()).toBe(204);
    const after = (await (
      await clientContext.request.get(`/api/groups/${groupId}/knowledge?type=chat_file`)
    ).json()) as KnowledgePage;
    expect(after.items.map((i) => i.title)).not.toContain(name);
    await admin.close();
  });

  test('an admin saves a chat file as a file: it leaves "Z chatu" and outlives the message', async () => {
    const name = `faktura-${stamp}.txt`;
    const fileId = await upload(clientContext.request, name, 'faktura');
    const channel = (await (
      await clientContext.request.get(`/api/groups/${groupId}/chat`)
    ).json()) as { id: string };
    const sent = await clientContext.request.post(`/api/channels/${channel.id}/messages`, {
      data: { clientId: `kb-file-${stamp}`, body: '', fileIds: [fileId] },
    });
    expect(sent.status()).toBe(201);
    const messageId = ((await sent.json()) as { id: string }).id;
    const chatFiles = (await (
      await adminContext.request.get(`/api/groups/${groupId}/knowledge?type=chat_file`)
    ).json()) as KnowledgePage;
    const item = chatFiles.items.find((i) => i.title === name)!;

    const admin = await adminContext.newPage();
    await admin.goto(`/groups/${groupId}/knowledge?k=${item.id}`);
    const dialog = admin.getByTestId('knowledge-dialog');
    await dialog.getByRole('button', { name: 'Uložiť ako súbor' }).click();
    await dialog.getByLabel('Názov').fill(`Faktúra ${stamp}`);
    await dialog.getByRole('button', { name: 'Uložiť ako súbor' }).click();
    await expect(dialog.getByRole('heading', { name: `Faktúra ${stamp}` })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Upraviť' })).toBeVisible();
    await admin.close();

    // A file item at the top level now, with its own copy; the message keeps its attachment.
    const detail = (await (
      await adminContext.request.get(`/api/knowledge/${item.id}`)
    ).json()) as KnowledgeItemDto;
    expect(detail).toMatchObject({ type: 'file', folderId: null, chat: null });
    const copyId = detail.files[0]!.id;
    expect(copyId).not.toBe(fileId);
    const after = (await (
      await clientContext.request.get(`/api/groups/${groupId}/knowledge?type=chat_file`)
    ).json()) as KnowledgePage;
    expect(after.items.map((i) => i.id)).not.toContain(item.id);

    // Deleting the message no longer removes the item or its file.
    expect((await clientContext.request.delete(`/api/messages/${messageId}`)).status()).toBe(204);
    expect((await clientContext.request.get(`/api/knowledge/${item.id}`)).status()).toBe(200);
    const download = await clientContext.request.get(`/api/files/${copyId}`);
    expect(download.status()).toBe(200);
    expect(await download.text()).toBe('faktura');
  });

  test('card view: several lines of a note, remembered, and a card opens the detail', async () => {
    const note = await create(adminContext.request, {
      type: 'note',
      title: `Karta ${stamp}`,
      body: `# Postup\n**Prvý** riadok poznámky\n- druhý riadok ${stamp}`,
      fileIds: [],
    });
    const page = await adminContext.newPage();
    // An explicit filter: an earlier test left "Z chatu" remembered for this group.
    await page.goto(`/groups/${groupId}/knowledge?type=note`);
    await page.getByRole('button', { name: 'Karty', exact: true }).click();
    const card = page.getByRole('listitem').filter({ hasText: note.title });
    await expect(card).toContainText('Prvý riadok poznámky');
    await expect(card).toContainText(`• druhý riadok ${stamp}`);
    await expect(card).not.toContainText('**');

    // The choice is kept: the next visit (and the global list) opens in cards.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Karty', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: `Otvoriť ${note.title}` }).click();
    await expect(page).toHaveURL(new RegExp(`k=${note.id}`));
    await expect(page.getByRole('dialog').getByRole('heading', { name: note.title })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Zoznam', exact: true }).click();
    await page.close();
  });

  test('phone viewport: the detail is a full-screen sheet and its controls are at least 44 px', async () => {
    const note = await create(adminContext.request, {
      type: 'note',
      title: `Mobil ${stamp}`,
      body: 'Text poznámky',
      fileIds: [],
    });
    const page = await adminContext.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/groups/${groupId}/knowledge?k=${note.id}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: note.title })).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(389);
    expect(box.height).toBeGreaterThanOrEqual(843);

    // Small icons with a larger pseudo-element hit area carry `data-hit`.
    const controls = dialog.locator('button:visible, a:visible, input:visible');
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      if ((await control.getAttribute('data-hit')) !== null) continue;
      const b = (await control.boundingBox())!;
      expect(b.height, `control ${i} is at least 44 px high`).toBeGreaterThanOrEqual(44);
    }
    await page.close();
  });
});
