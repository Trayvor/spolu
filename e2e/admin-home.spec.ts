import { expect, test, type APIRequestContext } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

/** Log in through the API with an emailed code: production rate limits allow few UI code requests. */
async function signIn(request: APIRequestContext, email: string) {
  await clearMailFor(request, email);
  const sent = await request.post('/api/auth/email-otp/send-verification-otp', {
    data: { email, type: 'sign-in' },
  });
  expect(sent.ok()).toBe(true);
  const otp = await latestLoginCode(request, email);
  expect((await request.post('/api/auth/sign-in/email-otp', { data: { email, otp } })).ok()).toBe(
    true,
  );
}

// A new admin N who manages G1 of two new groups; a client of G1 mentions N. The stored
// superadmin only sets things up. The UI is Slovak in e2e.
test('admin home: dashboard, sidebar, Úlohy and global board', async ({ page: setup, browser }) => {
  const stamp = Date.now();
  const g1Name = `E2E Domov A ${stamp}`;
  const g2Name = `E2E Domov B ${stamp}`;
  const nEmail = `e2e-home-admin-${stamp}@example.com`;
  const nName = `Nora ${stamp}`;
  const clientEmail = `e2e-home-client-${stamp}@example.com`;
  const clientName = `E2E Klient ${stamp}`;

  // 1. Through the API: two groups, admin N managing G1, a client in G1, a task in each group.
  const newGroup = async (name: string, slug: string) => {
    const res = await setup.request.post('/api/groups', {
      data: { name, egrantUrl: `https://e2e-home-${slug}-${stamp}.egrant.sk` },
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as { id: string; inviteUrl: string };
  };
  const g1 = await newGroup(g1Name, 'a');
  const g2 = await newGroup(g2Name, 'b');
  expect(
    (await setup.request.post('/api/admins', { data: { name: nName, email: nEmail } })).ok(),
  ).toBe(true);

  const nContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const cContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  try {
    await signIn(nContext.request, nEmail);
    const nId = ((await (await nContext.request.get('/api/me')).json()) as { id: string }).id;
    expect((await nContext.request.put(`/api/groups/${g1.id}/managers/me`)).ok()).toBe(true);
    const token = new URL(g1.inviteUrl).pathname.split('/').pop();
    expect(
      (await cContext.request.post(`/api/join/${token}`, { data: { email: clientEmail } })).ok(),
    ).toBe(true);
    await signIn(cContext.request, clientEmail);
    expect((await cContext.request.patch('/api/me', { data: { name: clientName } })).ok()).toBe(
      true,
    );
    const mine = await nContext.request.post(`/api/groups/${g1.id}/tasks`, {
      data: { title: `Rozpočet ${stamp}`, assigneeIds: [nId] },
    });
    expect(mine.status()).toBe(201);
    const other = await setup.request.post(`/api/groups/${g2.id}/tasks`, {
      data: { title: `Iná úloha ${stamp}` },
    });
    expect(other.status()).toBe(201);

    // 2. The client mentions N in G1's chat.
    const channel = (await (await cContext.request.get(`/api/groups/${g1.id}/chat`)).json()) as {
      id: string;
    };
    const sent = await cContext.request.post(`/api/channels/${channel.id}/messages`, {
      data: { body: `<@${nId}> môžeš to skontrolovať ${stamp}`, clientId: `e2e-${stamp}` },
    });
    expect(sent.status()).toBe(201);

    // 3. N opens the dashboard: the mention, the assigned task and the sidebar sections.
    const n = await nContext.newPage();
    await n.goto('/');
    const mentions = n.getByRole('region', { name: 'Zmienky' });
    const mention = mentions.getByRole('link', { name: new RegExp(`skontrolovať ${stamp}`) });
    await expect(mention).toBeVisible();
    await expect(mention).toContainText(clientName);
    const assigned = n.getByRole('region', { name: 'Priradené mne' });
    await expect(
      assigned.getByRole('link', { name: new RegExp(`Rozpočet ${stamp}`) }),
    ).toBeVisible();

    const sidebar = n.getByRole('navigation', { name: 'Klienti' });
    const managed = sidebar.locator('section').filter({
      has: n.getByRole('heading', { name: 'Spravujete vy' }),
    });
    const others = sidebar.locator('section').filter({
      has: n.getByRole('heading', { name: 'Ostatní klienti' }),
    });
    const g1Row = managed.getByRole('link', { name: new RegExp(g1Name) });
    await expect(g1Row).toBeVisible();
    await expect(g1Row).toContainText('1 neprečítaná správa');
    await expect(g1Row).toContainText('1 úloha priradená vám');
    await expect(others.getByRole('link', { name: new RegExp(g2Name) })).toBeVisible();

    // 4. Opening the mention shows the chat at the message; back home it is gone.
    await mention.click();
    await expect(n).toHaveURL(new RegExp(`/groups/${g1.id}/chat`));
    await expect(
      n.locator('[data-message-id]').filter({ hasText: `skontrolovať ${stamp}` }),
    ).toBeVisible();
    await n.goto('/');
    await expect(
      n.getByRole('region', { name: 'Zmienky' }).getByRole('link', {
        name: new RegExp(`skontrolovať ${stamp}`),
      }),
    ).toHaveCount(0, { timeout: 5_000 });

    // 5. G1's Úlohy tab carries the yellow pill.
    await n.goto(`/groups/${g1.id}/chat`);
    const tasksTab = n
      .getByRole('navigation', { name: 'Časti skupiny' })
      .getByRole('link', { name: /^Úlohy/ });
    await expect(tasksTab).toContainText('1 úloha priradená vám');

    // 6. The global board defaults to the managed G1; adding G2 shows its task.
    await n.goto('/tasks');
    await expect(n.getByRole('link', { name: new RegExp(`Rozpočet ${stamp}`) })).toBeVisible();
    await expect(n.getByRole('link', { name: new RegExp(`Iná úloha ${stamp}`) })).toHaveCount(0);
    await n.getByRole('button', { name: /^Klienti: Moji klienti/ }).click();
    // The sidebar has its own "Nájsť klienta" field: scope to the filter's popover.
    const picker = n.getByRole('dialog', { name: 'Klienti' });
    await picker.getByRole('searchbox', { name: 'Nájsť klienta' }).fill(g2Name);
    await picker.getByRole('checkbox', { name: new RegExp(g2Name) }).check();
    await picker.getByRole('button', { name: 'Hotovo' }).click();
    await expect(n.getByRole('link', { name: new RegExp(`Iná úloha ${stamp}`) })).toBeVisible();

    // 7. On a phone the home shows the count tiles and the client list.
    await n.setViewportSize({ width: 390, height: 844 });
    await n.goto('/');
    await expect(n.getByRole('button', { name: /^Priradené mne:/ })).toBeVisible();
    await expect(n.getByRole('button', { name: /^Zmienky:/ })).toBeVisible();
    // Three tiles once Phase 17's reminders source is registered (it is on this branch).
    await expect(n.getByRole('button', { name: /^Najbližšie pripomienky:/ })).toBeVisible();
    await expect(n.getByRole('link', { name: new RegExp(g1Name) })).toBeVisible();
    await expect(n.getByRole('navigation', { name: 'Klienti' })).toHaveCount(1);
  } finally {
    await nContext.close();
    await cContext.close();
  }
});
