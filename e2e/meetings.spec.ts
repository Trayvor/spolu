import { expect, test } from '@playwright/test';

// Phase 30 "Done when": an admin creates a meeting in a client's knowledge base, uploads its
// recording (kept as audio), processes it with AI (the fake transcription and summary, set in
// playwright.config.ts: TRANSCRIPTION_PROVIDER=fake, AI_PROVIDER=fake, FFMPEG_PATH=fake), edits
// nothing, turns the action items into tasks in a chosen bucket (the meeting then links to them),
// and sees the meeting on the dashboard's Meetings card.
test('a meeting: recording, AI summary, tasks from its action items, the dashboard card', async ({
  page,
}) => {
  const stamp = Date.now();
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E Stretnutia ${stamp}`, egrantUrl: `https://e2e-meet-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string };
  // The Meetings card shows the clients an admin manages (all when none): manage this one.
  expect((await page.request.put(`/api/groups/${group.id}/managers/me`)).ok()).toBe(true);

  // Create the meeting from "+ Nové", tomorrow at 10:00 (the form's default).
  await page.goto(`/groups/${group.id}/knowledge`);
  // The header's button; an empty list shows a second one.
  await page.getByRole('button', { name: 'Nové' }).first().click();
  await page.getByRole('menuitem', { name: /Stretnutie/ }).click();
  const dialog = page.getByTestId('knowledge-dialog');
  await dialog.getByLabel('Názov').fill(`Úvodné stretnutie ${stamp}`);
  await dialog.getByLabel('Odkaz na stretnutie').fill('https://teams.example.com/meet/1');
  await dialog.getByRole('button', { name: 'Pripomenúť 15 minút vopred' }).click();
  await dialog.getByRole('button', { name: 'Vytvoriť' }).click();
  await expect(dialog.getByRole('heading', { name: `Úvodné stretnutie ${stamp}` })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Pripojiť sa' })).toHaveAttribute(
    'href',
    'https://teams.example.com/meet/1',
  );

  // Upload a recording: only the compact audio is kept, and it plays.
  await dialog.getByTestId('meeting-recording-input').setInputFiles({
    name: 'hovor.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('ID3 fake audio bytes for the e2e transcoder'),
  });
  await expect(dialog.locator('audio')).toBeVisible({ timeout: 20_000 });

  // Process with AI: the fake transcript, then the summary with its action items.
  await dialog.getByRole('button', { name: 'Spracovať s AI' }).click();
  await expect(dialog.getByText('Poslať klientovi zoznam príloh.', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(dialog.getByText('Kto podpíše čestné vyhlásenie?', { exact: true })).toBeVisible();
  await expect(dialog.getByText('prepísala AI')).toBeVisible();

  // Action items → the review dialog → into the "eGrant review" bucket.
  await dialog.getByRole('button', { name: 'Vytvoriť úlohy' }).click();
  const review = page.getByTestId('review');
  await expect(review.getByText('Poslať klientovi zoznam príloh.').first()).toBeVisible();
  await review.getByRole('button', { name: 'Schváliť všetky' }).click();
  await review.getByLabel('Pridať do').selectOption({ label: 'Kontroluje eGrant' });
  await review.getByRole('button', { name: /Vytvoriť 2 úlohy/ }).click();
  await expect(page.getByText('Vytvorené 2 úlohy')).toBeVisible();

  // The meeting now shows links to its two tasks instead of the proposals (owner, 2026-10-17).
  await expect(dialog.getByText('Úlohy zo stretnutia')).toBeVisible();
  const budget = dialog.getByRole('link', { name: 'Peter pripraví rozpočet do 2030-01-15.' });
  await expect(budget).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Poslať klientovi zoznam príloh.' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Vytvoriť úlohy' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Vytvoriť ďalšie úlohy' })).toHaveCount(0);
  await expect(budget).toHaveAttribute('href', new RegExp(`/groups/${group.id}/tasks/`));

  // The board has them in that bucket.
  const board = (await (await page.request.get(`/api/groups/${group.id}/board`)).json()) as {
    buckets: { id: string; kind: string }[];
    tasks: { title: string; bucketId: string }[];
  };
  const review_ = board.buckets.find((b) => b.kind === 'egrant_review')!;
  expect(
    board.tasks.filter((task) => task.bucketId === review_.id).map((task) => task.title),
  ).toEqual(expect.arrayContaining(['Poslať klientovi zoznam príloh.']));

  // The dashboard's Meetings card lists it (tomorrow is within the next 7 days).
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Stretnutia' });
  const row = card.getByRole('link', { name: new RegExp(`Úvodné stretnutie ${stamp}`) });
  await expect(row).toBeVisible();

  // The card follows the notification settings (2026-10-17): on Mentions and replies the admin
  // hears nothing about this client's meetings, except the reminder they get (the author is its
  // recipient), so it stays; with the Meetings group on None it goes.
  const mode = (value: string) =>
    page.request.put(`/api/groups/${group.id}/notification-mode`, { data: { mode: value } });
  const meetingsChannel = (channel: string) =>
    page.request.patch('/api/notifications/preferences', {
      data: { category: 'meetings', channel },
    });
  expect((await mode('mentions')).status()).toBe(204);
  await page.reload();
  await expect(row).toBeVisible();
  expect((await meetingsChannel('none')).status()).toBe(200);
  await page.reload();
  await expect(card.getByText(`Úvodné stretnutie ${stamp}`)).toHaveCount(0);
  expect((await meetingsChannel('push')).status()).toBe(200);
  expect((await mode('all')).status()).toBe(204);
});

test('the notification settings list the Meetings notification group', async ({ page }) => {
  await page.goto('/settings/notifications');
  // Exact: the client table below names groups like "E2E Stretnutia …" too.
  await expect(page.getByRole('combobox', { name: 'Stretnutia', exact: true })).toHaveValue(
    /^(push|email|both|none)$/,
  );
  await expect(
    page.getByText('Nové a presunuté stretnutia, ich pripomienky a zhrnutia od AI'),
  ).toBeVisible();
});
