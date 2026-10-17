import { expect, test } from '@playwright/test';

/**
 * Phase 30 — bulk email builder v2: an admin builds a split container, edits the phone version
 * separately, returns it to the computer version, and gets the one-time "check the phone"
 * warning before sending (never sent here: the dialog is closed with "Teraz nie").
 */
test('bulk email builder: split container, phone version and the send warning', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stamp = Date.now();

  await page.goto('/bulk-email');
  await page.getByRole('button', { name: 'Nový e-mail' }).click();
  await expect(page).toHaveURL(/\/bulk-email\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  await page.getByLabel('Interný názov').fill(`E2E builder ${stamp}`);
  await page.getByLabel('Predmet').fill(`Builder ${stamp}`);

  const add = page.getByRole('group', { name: 'Pridať blok', exact: true });
  const main = page.getByRole('list', { name: 'Bloky' });

  // 1. A formatted text: **word** becomes bold as it is typed.
  await add.getByRole('button', { name: 'Text', exact: true }).click();
  await main
    .getByRole('textbox', { name: 'Text' })
    .first()
    .fill('Dobrý deň, {{name}}, **novinky**');
  await expect(main.locator('[contenteditable] b')).toHaveText('novinky');

  // 2. A split container with a text on the left and a button on the right.
  await add.getByRole('button', { name: 'Rozdelený blok', exact: true }).click();
  const left = page.getByRole('region', { name: 'Ľavý stĺpec bloku 2' });
  const right = page.getByRole('region', { name: 'Pravý stĺpec bloku 2' });
  await left
    .getByRole('group', { name: 'Pridať blok do: Ľavý stĺpec bloku 2' })
    .getByRole('button', { name: 'Text', exact: true })
    .click();
  await left.getByRole('textbox', { name: 'Text' }).fill('Vľavo');
  await right
    .getByRole('group', { name: 'Pridať blok do: Pravý stĺpec bloku 2' })
    .getByRole('button', { name: 'Tlačidlo', exact: true })
    .click();
  await right.getByRole('textbox', { name: 'Text tlačidla' }).fill('Otvoriť');
  await right.getByRole('textbox', { name: 'Odkaz', exact: true }).fill('https://egrant.sk');
  await page.getByLabel('Šírka stĺpcov').selectOption({ label: 'Tretina a dve tretiny' });
  await expect(page.getByText('Všetky zmeny sú uložené')).toBeVisible();

  // The preview renders the container as table cells that stack on phones.
  const frame = page.frameLocator('iframe[title="Náhľad e-mailu"]');
  await expect(frame.getByText('Vľavo')).toBeVisible();

  // 3. Phone mode follows the computer version until the first edit there.
  const state = page.getByTestId('phone-version-state');
  await expect(state).toHaveText('Verzia pre telefón: rovnaká ako pre počítač');
  await page.getByRole('button', { name: 'Telefón', exact: true }).click();
  await expect(page.locator('iframe[title="Náhľad e-mailu"]')).toHaveAttribute('width', '375');
  await page.getByRole('button', { name: 'Vymazať blok 2 (Rozdelený blok)' }).click();
  await expect(state).toHaveText('Verzia pre telefón: upravená zvlášť');
  await expect(page.getByText('Všetky zmeny sú uložené')).toBeVisible();

  let saved = await (await page.request.get(`/api/bulk-email/campaigns/${id}`)).json();
  expect(saved.blocks).toHaveLength(2);
  expect(saved.phoneBlocks).toHaveLength(1);

  // The computer version still has its container.
  await page.getByRole('button', { name: 'Počítač', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ľavý stĺpec bloku 2' })).toBeVisible();

  // 4. Return to the computer version: the phone follows desktop again.
  await page.getByRole('button', { name: 'Vrátiť verziu pre počítač' }).click();
  await page.getByRole('button', { name: 'Zahodiť verziu pre telefón' }).click();
  await expect(state).toHaveText('Verzia pre telefón: rovnaká ako pre počítač');
  await expect(page.getByText('Všetky zmeny sú uložené')).toBeVisible();
  saved = await (await page.request.get(`/api/bulk-email/campaigns/${id}`)).json();
  expect(saved.phoneBlocks).toBeNull();

  // 5. Recipients: the admins (the email is never sent in this test).
  await page.getByRole('checkbox', { name: 'Admini' }).check();
  await expect(page.getByText('Všetky zmeny sú uložené')).toBeVisible();

  // 6. Send…: the one-time warning, "Show phone preview" switches to Phone.
  await page.getByRole('button', { name: 'Odoslať…' }).click();
  const check = page.getByTestId('phone-check-dialog');
  await expect(
    check.getByRole('heading', { name: 'Pozrite sa, ako e-mail vyzerá na telefóne' }),
  ).toBeVisible();
  await check.getByRole('button', { name: 'Ukázať náhľad na telefóne' }).click();
  await expect(check).toBeHidden();
  await expect(page.getByRole('button', { name: 'Telefón', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('send-dialog')).toBeHidden();

  // Shown once per campaign, also after a reload.
  saved = await (await page.request.get(`/api/bulk-email/campaigns/${id}`)).json();
  expect(saved.phoneCheckShown).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Odoslať…' }).click();
  await expect(page.getByTestId('send-dialog')).toBeVisible();
  await expect(page.getByTestId('phone-check-dialog')).toBeHidden();
  await page.getByTestId('send-dialog').getByRole('button', { name: 'Teraz nie' }).click();

  // Clean up the draft.
  expect((await page.request.delete(`/api/bulk-email/campaigns/${id}`)).status()).toBe(204);
});
