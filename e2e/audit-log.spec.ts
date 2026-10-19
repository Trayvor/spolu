import { expect, test } from '@playwright/test';
import { logInWithCode } from './login';
import { clearMailFor, latestLoginCode } from './mailpit';

// The audit log „História zmien“ (spec 2026-10-19-audit-log-design.md §4): written per the plan
// (Task 15) and run in the orchestrator's final e2e pass, not by the implementing agent.
test('an edited task shows in its history; filters; finance rows only with the right; clients get no page', async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const me = (await (await page.request.get('/api/me')).json()) as { id: string; name: string };

  // A client group and a task with a due date, then an edit of the due date and the description.
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E Audit ${stamp}`, egrantUrl: `https://e2e-audit-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const groupId = ((await created.json()) as { id: string }).id;
  const made = await page.request.post(`/api/groups/${groupId}/tasks`, {
    data: {
      title: `E2E rozpočet ${stamp}`,
      description: '',
      assigneeIds: [],
      dueDate: '2026-11-20',
      urgent: false,
      fileIds: [],
      link: null,
    },
  });
  expect(made.status()).toBe(201);
  const task = (await made.json()) as { id: string; updatedAt: string };
  const edited = await page.request.patch(`/api/tasks/${task.id}`, {
    data: { dueDate: '2026-11-24', description: 'Tajný popis', updatedAt: task.updatedAt },
  });
  expect(edited.ok()).toBe(true);

  // The task's „…“ menu → „História“: the edit with the due date's from and to, the description
  // only as changed.
  await page.goto(`/groups/${groupId}/tasks/${task.id}`);
  await page.getByRole('button', { name: 'Viac' }).click();
  await page.getByRole('menuitem', { name: 'História' }).click();
  await expect(page).toHaveURL(/\/audit\?/);
  await expect(page.getByRole('heading', { name: 'História zmien' })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'Úprava úlohy' });
  await expect(row).toContainText(`E2E rozpočet ${stamp}`);
  await expect(row).toContainText('Popis: zmenený');
  await expect(row).toContainText('Termín:');
  await expect(row).not.toContainText('Tajný popis');

  // Kind of record „Úlohy“ and the author: still there; another author: gone.
  await page.getByRole('button', { name: /Zrušiť filter/ }).click();
  await page.getByLabel('Druh záznamu').selectOption('task');
  await page.getByLabel('Klient').selectOption(groupId);
  await page.getByLabel('Autor').selectOption(`user:${me.id}`);
  await expect(page.getByRole('listitem').filter({ hasText: 'Úprava úlohy' })).toBeVisible();
  await page.getByLabel('Autor').selectOption('kind:egrant');
  await expect(page.getByText('Žiadne zmeny pre tieto filtre.')).toBeVisible();

  // A finance item of the client, made by the superadmin (a finance admin).
  const item = await page.request.post(`/api/groups/${groupId}/finance/items`, {
    data: { type: 'note', title: `E2E finančná poznámka ${stamp}` },
  });
  expect(item.status()).toBe(201);

  // An admin who is not the superadmin opens the log, without the finance right: no finance row.
  const adminEmail = `e2e-audit-${stamp}@example.com`;
  expect(
    (
      await page.request.post('/api/admins', {
        data: { email: adminEmail, name: `E2E Audit Admin ${stamp}` },
      })
    ).status(),
  ).toBe(201);
  const adminContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const admin = await adminContext.newPage();
  await logInWithCode(admin, adminContext.request, adminEmail);
  await admin.goto(`/audit?group=${groupId}`);
  await expect(admin.getByRole('heading', { name: 'História zmien' })).toBeVisible();
  await expect(admin.getByText(`E2E rozpočet ${stamp}`).first()).toBeVisible();
  await expect(admin.getByText(`E2E finančná poznámka ${stamp}`)).toHaveCount(0);
  await adminContext.close();
  // The superadmin sees it.
  await page.goto(`/audit?group=${groupId}`);
  await expect(page.getByText(`E2E finančná poznámka ${stamp}`).first()).toBeVisible();

  // A client of the group: no page.
  await page.goto(`/groups/${groupId}/members`);
  const inviteUrl = await page.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();
  const email = `e2e-audit-client-${stamp}@example.com`;
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const client = await context.newPage();
  await client.goto(new URL(inviteUrl).pathname);
  await clearMailFor(context.request, email);
  await client.getByLabel('E-mail').fill(email);
  await client.getByRole('button', { name: 'Poslať kód' }).click();
  await client.getByLabel('Kód').fill(await latestLoginCode(context.request, email));
  await client.getByLabel('Vaše meno').fill('E2E Audit Client');
  await client.getByRole('button', { name: 'Pokračovať' }).click();
  await expect(client).toHaveURL(new RegExp(`/groups/${groupId}/chat$`));
  await client.goto('/audit');
  await expect(client.getByRole('heading', { name: 'Stránka sa nenašla' })).toBeVisible();
  expect((await context.request.get('/api/audit')).status()).toBe(403);
  await context.close();
});
