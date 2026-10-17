import { expect, test } from '@playwright/test';

// Phase 30 "Done when": an admin creates a meeting in a client's knowledge base, uploads its
// recording (kept as audio), processes it with AI (the fake transcription and summary, set in
// playwright.config.ts: TRANSCRIPTION_PROVIDER=fake, AI_PROVIDER=fake, FFMPEG_PATH=fake), edits
// nothing, turns the action items into tasks in a chosen bucket, and sees the meeting on the
// dashboard's Meetings card.
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
  await page.getByRole('button', { name: 'Nové' }).click();
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
  await expect(dialog.getByText('Poslať klientovi zoznam príloh.')).toBeVisible({
    timeout: 20_000,
  });
  await expect(dialog.getByText('Kto podpíše čestné vyhlásenie?')).toBeVisible();
  await expect(dialog.getByText('prepísala AI')).toBeVisible();

  // Action items → the review dialog → into the "eGrant review" bucket.
  await dialog.getByRole('button', { name: 'Vytvoriť úlohy' }).click();
  const review = page.getByTestId('review');
  await expect(review.getByText('Poslať klientovi zoznam príloh.').first()).toBeVisible();
  await review.getByRole('button', { name: 'Schváliť všetky' }).click();
  await review.getByLabel('Pridať do').selectOption({ label: 'Kontrola eGrant' });
  await review.getByRole('button', { name: /Vytvoriť 2 úlohy/ }).click();
  await expect(page.getByText('Vytvorené 2 úlohy')).toBeVisible();

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
  await expect(
    card.getByRole('link', { name: new RegExp(`Úvodné stretnutie ${stamp}`) }),
  ).toBeVisible();
});
