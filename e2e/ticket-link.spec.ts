import { expect, test } from '@playwright/test';
import { withDb } from './db';
import { waitForMessage } from './mailpit';

// ADR 0020: the "Ticket created" email signs the requester in with one click.
const KEY = 'e2e-tickets-key-0123456789';

test('the ticket email link signs a nameless requester in, asks the name, opens the ticket', async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const host = `e2e-link-${stamp}.egrant.sk`;
  const email = `e2e-link-${stamp}@example.com`;
  const subject = `Odkaz z e-mailu ${stamp}`;

  // A client whose eGrant instance sends the ticket (the admin's session is the default state).
  const group = await page.request.post('/api/groups', {
    data: { name: `E2E Odkaz ${stamp}`, egrantUrl: `https://${host}` },
  });
  expect(group.status()).toBe(201);
  const created = await page.request.post('/api/tickets/intake', {
    headers: { authorization: `Bearer ${KEY}` },
    data: { subject, email, instance_url: `https://${host}` }, // no requester_name
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const mail = await waitForMessage(page.request, email, /bol vytvorený/);
  const link = new URL(/https?:\/\/\S+\/t#[A-Za-z0-9_-]+/.exec(mail.Text)![0]);

  // A fresh browser: no session. The link signs in, the name step comes first, then the ticket.
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const requester = await context.newPage();
  await requester.goto(link.pathname + link.hash);
  await expect(requester.getByRole('heading', { name: 'Ako vás máme oslovovať?' })).toBeVisible();
  await requester.getByLabel('Vaše meno').fill('Eva Odkazová');
  await requester.getByRole('button', { name: 'Pokračovať' }).click();
  await expect(requester).toHaveURL(new RegExp(`/tickets/${id}$`));
  await expect(requester.getByRole('heading', { name: subject })).toBeVisible();

  // The link works again within its 7 days (another device).
  const phone = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const second = await phone.newPage();
  await second.goto(link.pathname + link.hash);
  await expect(second).toHaveURL(new RegExp(`/tickets/${id}$`));

  // Expired: the login page says so, with the email filled in.
  await withDb(
    (sql) =>
      sql`update ticket_sign_in_links set expires_at = now() - interval '1 minute'
          where ticket_id = ${id}`,
  );
  const late = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const third = await late.newPage();
  await third.goto(link.pathname + link.hash);
  await expect(third.getByText('Odkaz už neplatí. Prihláste sa svojím e-mailom.')).toBeVisible();
  await expect(third.getByLabel('E-mail')).toHaveValue(email);

  await Promise.all([context.close(), phone.close(), late.close()]);
});
