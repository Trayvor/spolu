import { expect, test } from '@playwright/test';
import { setEditorText } from './editor';
import { clearMailFor, latestLoginCode } from './mailpit';

// Phase 33 part P5, spec §14 scenario 8: the description editor outside the chat, on the fake
// providers (AI_PROVIDER=fake and TRANSCRIPTION_PROVIDER=fake in playwright.config.ts) and
// Chromium's fake microphone. The admin dictates a task description, makes it formal, attaches
// a public note and creates the task; the group's client sees the note's card, and once the
// note is admins-only, "Item unavailable".

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('a task description with voice, AI and attached knowledge', async ({
  page: admin,
  browser,
}) => {
  const stamp = Date.now();
  const email = `e2e-editor-${stamp}@example.com`;
  const created = await admin.request.post('/api/groups', {
    data: { name: `E2E Editor ${stamp}`, egrantUrl: `https://e2e-editor-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string; inviteUrl: string };
  const token = new URL(group.inviteUrl).pathname.split('/').pop();
  const note = await admin.request.post(`/api/groups/${group.id}/knowledge`, {
    data: { type: 'note', title: 'Postup podania', body: 'Krok za krokom.' },
  });
  expect(note.status()).toBe(201);
  const noteDto = (await note.json()) as { id: string; updatedAt: string };

  // The admin writes the task.
  await admin.goto(`/groups/${group.id}/tasks/new`);
  const panel = admin.getByRole('complementary', { name: 'Úloha' });
  await panel.getByLabel('Názov', { exact: true }).fill('Podanie');
  await panel
    .getByRole('textbox', { name: 'Odkaz', exact: true })
    .fill('https://egrant.sk/podanie');
  const box = panel.getByRole('textbox', { name: 'Popis' });
  await expect(box).toBeVisible();
  await panel.getByRole('button', { name: 'Diktovať' }).click();
  // Record at least a second: a Stop right after the start can leave an empty recording. The
  // transcription and AI waits get 15 s: they go through the server and its jobs, slow under load.
  await expect(panel.getByRole('timer')).toContainText(/0:0[1-9] \//, { timeout: 15_000 });
  await panel.getByRole('button', { name: 'Zastaviť a prepísať' }).click();
  await expect(box).toHaveText(/^Anna: Dobrý deň, poďme na rozpočet projektu\./, {
    timeout: 15_000,
  });

  // Not `fill`: the transcript has just landed and ProseMirror may write its caret back
  // (see setEditorText). The text must be in before the AI tool reads it.
  const draft = 'task one: call the bank, task two: send the report';
  await setEditorText(box, draft);
  await expect(box).toHaveText(draft);
  await panel.getByRole('button', { name: 'AI nástroje' }).click();
  await admin.getByRole('menuitem', { name: 'Formálnejšie' }).click();
  await expect(box.locator('ol li')).toHaveText(['Call the bank', 'Send the report'], {
    timeout: 15_000,
  });

  await panel.getByRole('button', { name: 'Priložiť zo Znalostí' }).click();
  await admin.getByRole('checkbox', { name: /Postup podania/ }).check();
  await admin.getByRole('button', { name: 'Priložiť (1)' }).click();
  await expect(
    panel.getByRole('list', { name: 'Priložené položky znalostí' }).getByText('Postup podania'),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Vytvoriť' }).click();
  await expect(panel).toHaveCount(0);

  // A client of the group logs in through the API and opens the task.
  const clientContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const request = clientContext.request;
  try {
    await clearMailFor(request, email);
    expect((await request.post(`/api/join/${token}`, { data: { email } })).ok()).toBe(true);
    expect(
      (
        await request.post('/api/auth/email-otp/send-verification-otp', {
          data: { email, type: 'sign-in' },
        })
      ).ok(),
    ).toBe(true);
    const otp = await latestLoginCode(request, email);
    expect((await request.post('/api/auth/sign-in/email-otp', { data: { email, otp } })).ok()).toBe(
      true,
    );
    // A named person skips the welcome page.
    expect((await request.patch('/api/me', { data: { name: 'E2E Klient' } })).ok()).toBe(true);
    const client = await clientContext.newPage();
    await client.goto(`/groups/${group.id}/tasks`);
    await client.getByRole('link', { name: 'Podanie' }).click();
    const seen = client.getByRole('complementary', { name: 'Úloha' });
    await expect(seen.getByRole('button', { name: /Postup podania/ })).toBeVisible();

    // The note goes admins-only: the client sees "Item unavailable" after a reload.
    const hidden = await admin.request.patch(`/api/knowledge/${noteDto.id}`, {
      data: { visibility: 'admins', updatedAt: noteDto.updatedAt },
    });
    expect(hidden.status()).toBe(200);
    await client.reload();
    await expect(
      client.getByRole('complementary', { name: 'Úloha' }).getByText('Položka nie je dostupná'),
    ).toBeVisible();
  } finally {
    await clientContext.close();
  }
});
