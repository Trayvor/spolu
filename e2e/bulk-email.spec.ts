import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { SUPERADMIN_EMAIL } from './env';
import { clearMailFor, latestLoginCode, waitForMessage } from './mailpit';

// Mailpit's API; 127.0.0.1, not localhost (Node DNS issue), as in mailpit.ts.
const MAILPIT = 'http://127.0.0.1:8025';
const ADMIN_EMAIL = SUPERADMIN_EMAIL;

/** Log in through the API with an emailed code: production rate limits allow few UI requests. */
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

type MailpitMessage = { ID: string; Subject: string; Text: string; HTML: string };

/** The newest message to `email` whose subject matches, with its HTML; polls until it arrives. */
async function bulkMessage(
  request: APIRequestContext,
  email: string,
  subject: RegExp,
): Promise<MailpitMessage> {
  const message = (await waitForMessage(request, email, subject)) as MailpitMessage;
  return message;
}

/** The message's headers, as Mailpit reports them (name → values). */
async function headersOf(request: APIRequestContext, id: string) {
  const res = await request.get(`${MAILPIT}/api/v1/message/${id}/headers`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as Record<string, string[]>;
}

/** The footer's unsubscribe link (Spolu's page) in the text part. */
function footerLink(message: MailpitMessage): string {
  const link = /https?:\/\/\S+\/unsubscribe\/[A-Za-z0-9._-]+/.exec(message.Text)?.[0];
  expect(link, message.Text).toBeTruthy();
  return link!;
}

/** The value shown for one number of the report (its label is the figure's caption). */
const figure = (page: Page, label: string) =>
  page
    .getByRole('list', { name: 'Výsledok odosielania' })
    .getByRole('listitem')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('[data-value]');

// An admin writes and sends a bulk email to a client group; the clients get it with their names
// and Spolu's unsubscribe link and header; one client unsubscribes through the footer link, the
// other through the List-Unsubscribe one-click; Settings shows it and subscribing again works.
test('bulk email: write, test, send, report, unsubscribe and subscribe again', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const groupName = `E2E Hromadné ${stamp}`;
  const subject = `Novinky ${stamp}`;
  const clients = [
    { email: `e2e-bulk-a-${stamp}@example.com`, name: `Anna Bulk ${stamp}` },
    { email: `e2e-bulk-b-${stamp}@example.com`, name: `Boris Bulk ${stamp}` },
  ];

  // Setup through the API: a client group and two clients who joined it and set their names.
  const created = await page.request.post('/api/groups', {
    data: { name: groupName, egrantUrl: `https://e2e-bulk-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string; inviteUrl: string };
  const inviteToken = new URL(group.inviteUrl).pathname.split('/').pop();
  const contexts = await Promise.all(
    clients.map(() => browser.newContext({ locale: 'sk-SK', storageState: undefined })),
  );
  try {
    for (const [i, client] of clients.entries()) {
      const request = contexts[i]!.request;
      expect(
        (await request.post(`/api/join/${inviteToken}`, { data: { email: client.email } })).ok(),
      ).toBe(true);
      await signIn(request, client.email);
      expect((await request.patch('/api/me', { data: { name: client.name } })).ok()).toBe(true);
      await clearMailFor(request, client.email);
    }

    // 1. A new email from the list.
    await page.goto('/bulk-email');
    await page.getByRole('button', { name: 'Nový e-mail' }).click();
    await expect(page).toHaveURL(/\/bulk-email\/[0-9a-f-]{36}$/);
    await page.getByLabel('Interný názov').fill(`E2E ${stamp}`);
    await page.getByLabel('Predmet').fill(subject);

    // 2. Blocks: a heading with {{name}}, a text, a button and the logo.
    const add = page.getByRole('group', { name: 'Pridať blok' });
    const blocks = page.getByRole('list', { name: 'Bloky' }).getByRole('listitem');
    await add.getByRole('button', { name: 'Nadpis', exact: true }).click();
    await blocks.nth(0).getByRole('textbox', { name: 'Text' }).fill('Dobrý deň, {{name}}');
    await add.getByRole('button', { name: 'Text', exact: true }).click();
    await blocks
      .nth(1)
      .getByRole('textbox', { name: 'Text' })
      .fill('Máme pre vás **novinky** o výzvach.');
    await add.getByRole('button', { name: 'Tlačidlo', exact: true }).click();
    await blocks.nth(2).getByRole('textbox', { name: 'Text tlačidla' }).fill('Otvoriť eGrant');
    await blocks
      .nth(2)
      .getByRole('textbox', { name: 'Odkaz', exact: true })
      .fill('https://egrant.sk');
    await add.getByRole('button', { name: 'Logo eGrant', exact: true }).click();
    await expect(blocks).toHaveCount(4);

    // 3. Recipients: the clients of the new group.
    await page.getByRole('checkbox', { name: 'Klienti' }).check();
    await page.getByLabel('Nájsť skupinu').fill(groupName);
    await page.getByRole('checkbox', { name: groupName }).check();
    await expect(page.getByText('E-mail dostanú 2 ľudia')).toBeVisible();
    await expect(page.getByText('Všetky zmeny sú uložené')).toBeVisible();

    // 4. A test to me: it arrives with [Test] and my name.
    await clearMailFor(page.request, ADMIN_EMAIL);
    await page.getByRole('button', { name: 'Poslať mi test' }).click();
    await expect(page.getByText(`Test bol odoslaný na ${ADMIN_EMAIL}.`)).toBeVisible();
    const testMail = await bulkMessage(
      page.request,
      ADMIN_EMAIL,
      new RegExp(`^\\[Test\\] ${subject}$`),
    );
    expect(testMail.Text).toContain('Otvoriť eGrant: https://egrant.sk');

    // 5. Send: the dialog names the subject, the sender and the live count.
    await page.getByRole('button', { name: 'Odoslať…' }).click();
    // Phase 31: the phone version follows the computer one, so a one-time reminder comes first.
    await page
      .getByTestId('phone-check-dialog')
      .getByRole('button', { name: 'Napriek tomu odoslať' })
      .click();
    const dialog = page.getByTestId('send-dialog');
    await expect(dialog.getByRole('heading', { name: 'Poslať 2 osobám?' })).toBeVisible();
    await expect(dialog.getByText(subject)).toBeVisible();
    await expect(dialog.getByText('Help by eGrant <noreply@localhost>')).toBeVisible();
    await dialog.getByRole('button', { name: 'Poslať 2 osobám' }).click();

    // 6. The report: sent to both, live through bulk:updated.
    await expect(
      page.getByText('Aplikácia Help zatiaľ nemeria otvorenia ani kliknutia', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('Odoslaný', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(figure(page, 'Príjemcovia')).toHaveText('2');
    await expect(figure(page, 'Odoslané')).toHaveText('2');
    await expect(figure(page, 'Zlyhané')).toHaveText('0');
    const people = page.getByRole('list', { name: 'Ľudia' });
    for (const client of clients) await expect(people.getByText(client.name)).toBeVisible();

    // Both clients got it with their own name, Spolu's link and the one-click header.
    const mails = await Promise.all(
      clients.map((c) => bulkMessage(page.request, c.email, new RegExp(`^${subject}$`))),
    );
    for (const [i, mail] of mails.entries()) {
      expect(mail.HTML).toContain(`Dobrý deň, ${clients[i]!.name}`);
      expect(mail.HTML).toMatch(/<strong[^>]*>novinky<\/strong>/);
      expect(mail.HTML).toContain('/brand/egrant-logo-email.png');
      const headers = await headersOf(page.request, mail.ID);
      expect(headers['List-Unsubscribe-Post']).toEqual(['List-Unsubscribe=One-Click']);
      expect(headers['List-Unsubscribe']?.[0]).toMatch(/\/unsubscribe\/[^>]+\/one-click>$/);
    }

    // 7a. Anna opens the footer link: Spolu's page unsubscribes her.
    const anna = await contexts[0]!.newPage();
    await anna.goto(footerLink(mails[0]!));
    await expect(anna.getByRole('heading', { name: 'Boli ste odhlásení' })).toBeVisible();

    // 7b. Boris's mail app posts the one-click unsubscribe from the header.
    const headersB = await headersOf(page.request, mails[1]!.ID);
    const oneClick = /<([^>]+)>/.exec(headersB['List-Unsubscribe']![0]!)![1]!;
    const posted = await contexts[1]!.request.post(oneClick, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'List-Unsubscribe=One-Click',
    });
    expect(posted.status()).toBe(204);

    // The report counts both as unsubscribed through this email.
    await page.reload();
    await expect(figure(page, 'Odhlásení')).toHaveText('2');

    // 8. Settings shows Anna unsubscribed; she ticks "Receive mailings" again.
    await anna.goto('/settings');
    const setting = anna.getByRole('checkbox', { name: 'Dostávať hromadné e-maily' });
    await expect(setting).not.toBeChecked();
    await setting.check();
    await expect(setting).toBeChecked();
    // The checkbox saves on change: wait for the server to have it.
    await expect
      .poll(async () => (await contexts[0]!.request.get('/api/me/bulk-email')).json())
      .toEqual({ subscribed: true });

    // Boris subscribes again from the page his link opens.
    const boris = await contexts[1]!.newPage();
    await boris.goto(footerLink(mails[1]!));
    await expect(boris.getByRole('heading', { name: 'Boli ste odhlásení' })).toBeVisible();
    await boris.getByRole('button', { name: 'Znova prihlásiť' }).click();
    await expect(boris.getByRole('heading', { name: 'Znova ste prihlásení' })).toBeVisible();
    await boris.goto('/settings');
    await expect(boris.getByRole('checkbox', { name: 'Dostávať hromadné e-maily' })).toBeChecked();

    // Both count again for the next email to the group.
    const count = await page.request.post('/api/bulk-email/audience/count', {
      data: {
        groupIds: [group.id],
        managerIds: [],
        roles: ['client'],
        includeUserIds: [],
        excludeUserIds: [],
      },
    });
    expect(await count.json()).toEqual({ count: 2, leftOut: { unsubscribed: 0, disabled: 0 } });
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
