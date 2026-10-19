import { expect, test, type APIRequestContext } from '@playwright/test';
import { withDb } from './db';
import { clearMailFor, latestLoginCode, waitForMessage } from './mailpit';

// 2026-10-19: the requester rates a resolved ticket; every admin sees the rating and comment,
// other clients of the group see nothing. Written with the feature, run in the final e2e pass.
const KEY = 'e2e-tickets-key-0123456789';

/** Log in through the API with an emailed code (production rate limits allow few UI requests). */
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

test('the requester rates a resolved ticket; admins see it live, other clients never', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const stamp = `${Date.now()}-${test.info().repeatEachIndex}`;
  const host = `e2e-rate-${stamp}.egrant.sk`;
  const email = `e2e-rate-${stamp}@example.com`;
  const managerEmail = `e2e-rate-mgr-${stamp}@example.com`;
  const otherEmail = `e2e-rate-other-${stamp}@example.com`;
  const clientEmail = `e2e-rate-client-${stamp}@example.com`;
  const subject = `Hodnotenie ${stamp}`;
  const comment = `Stále to nefunguje ${stamp}`;

  // Setup through the API (the superadmin's session is the default state): a client group, an
  // admin who manages it, an admin who neither manages it nor solves the ticket, and a client.
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E Hodnotenie ${stamp}`, egrantUrl: `https://${host}` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string; inviteUrl: string };
  const token = new URL(group.inviteUrl).pathname.split('/').pop();
  for (const [name, address] of [
    [`E2E Manažér ${stamp}`, managerEmail],
    [`E2E Iný admin ${stamp}`, otherEmail],
  ]) {
    expect((await page.request.post('/api/admins', { data: { name, email: address } })).ok()).toBe(
      true,
    );
  }
  const contexts = await Promise.all(
    [0, 1, 2, 3].map(() => browser.newContext({ locale: 'sk-SK', storageState: undefined })),
  );
  const [managerContext, otherContext, clientContext, requesterContext] = contexts;
  try {
    await signIn(managerContext!.request, managerEmail);
    expect((await managerContext!.request.put(`/api/groups/${group.id}/managers/me`)).ok()).toBe(
      true,
    );
    const managerId = (
      (await (await managerContext!.request.get('/api/me')).json()) as { id: string }
    ).id;
    await signIn(otherContext!.request, otherEmail);
    expect(
      (
        await clientContext!.request.post(`/api/join/${token}`, { data: { email: clientEmail } })
      ).ok(),
    ).toBe(true);
    await signIn(clientContext!.request, clientEmail);

    // 1. The intake creates the ticket for a new žiadateľ; the manager resolves it.
    const intake = await page.request.post('/api/tickets/intake', {
      headers: { authorization: `Bearer ${KEY}` },
      data: { subject, email, requester_name: 'Eva Hodnotiaca', instance_url: `https://${host}` },
    });
    expect(intake.status()).toBe(201);
    const { id } = (await intake.json()) as { id: string };
    const mail = await waitForMessage(page.request, email, /bol vytvorený/);
    const link = new URL(/https?:\/\/\S+\/t#[A-Za-z0-9_-]+/.exec(mail.Text)![0]);
    const resolved = await managerContext!.request.patch(`/api/tickets/${id}`, {
      data: { status: 'resolved' },
    });
    expect(resolved.ok()).toBe(true);

    // The manager has the ticket open: the rating arrives live.
    const manager = await managerContext!.newPage();
    await manager.goto(`/tickets/${id}`);
    await expect(manager.getByText('Zatiaľ bez hodnotenia')).toBeVisible();

    // 2. The žiadateľ signs in through the one-click link and opens the resolved notice's link.
    const requester = await requesterContext!.newPage();
    await requester.goto(link.pathname + link.hash);
    await expect(requester).toHaveURL(new RegExp(`/tickets/${id}$`));
    await requester.goto(`/tickets/${id}?rate=1`);
    await expect(requester.getByRole('heading', { name: 'Ako sme vám pomohli?' })).toBeVisible();
    await expect(requester.getByRole('button', { name: 'Pomohlo', exact: true })).toBeFocused();
    await expect(requester).toHaveURL(new RegExp(`/tickets/${id}$`));
    await requester.getByRole('button', { name: 'Nepomohlo' }).click();
    await requester.getByLabel('Chcete nám niečo odkázať? (nepovinné)').fill(comment);
    await requester.getByRole('button', { name: 'Odoslať' }).click();
    await expect(requester.getByRole('heading', { name: 'Ďakujeme za hodnotenie.' })).toBeVisible();
    await expect(requester.getByText(comment)).toBeVisible();

    // 3. The manager sees the rating and comment without a reload, and got `ticket.rated`.
    await expect(manager.getByText(comment)).toBeVisible({ timeout: 30_000 });
    await expect(manager.getByText('Nepomohlo')).toBeVisible();
    await expect(manager.getByText(/Eva Hodnotiaca · /)).toBeVisible();
    await expect
      .poll(
        () =>
          withDb(
            (sql) =>
              sql`select 1 from notification_events
                  where kind = 'ticket.rated' and user_id = ${managerId}
                    and payload->>'ticketId' = ${id}`,
          ).then((rows) => rows.length),
        { timeout: 30_000 },
      )
      .toBe(1);

    // 4. A client of the same group sees no rating at all.
    const client = await clientContext!.newPage();
    await client.goto(`/tickets/${id}`);
    await expect(client.getByRole('heading', { name: subject })).toBeVisible();
    await expect(client.getByText('Hodnotenie', { exact: true })).toHaveCount(0);
    await expect(client.getByText(comment)).toHaveCount(0);
    await expect(client.getByRole('button', { name: 'Pomohlo', exact: true })).toHaveCount(0);

    // 5. An admin who is neither the riešiteľ nor the client's manager sees the same.
    const other = await otherContext!.newPage();
    await other.goto(`/tickets/${id}`);
    await expect(other.getByText(comment)).toBeVisible();

    // 6. The žiadateľ changes it to Pomohlo; the ratings view shows 100 % and the comment.
    await requester.getByRole('button', { name: 'Pomohlo', exact: true }).click();
    await expect(requester.getByRole('button', { name: 'Pomohlo', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.goto(`/tickets/ratings?groupId=${group.id}`);
    await expect(page.getByRole('heading', { name: 'Hodnotenia tiketov' })).toBeVisible();
    await expect(page.getByText(/100\s%/)).toBeVisible();
    await expect(page.getByText(comment)).toBeVisible();

    // 7. Fifteen days after resolving, the card is read-only.
    await withDb(
      (sql) => sql`update tickets set resolved_at = now() - interval '15 days' where id = ${id}`,
    );
    await requester.reload();
    await expect(requester.getByText('Vaše hodnotenie: Pomohlo')).toBeVisible();
    await expect(requester.getByRole('button', { name: 'Nepomohlo' })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
