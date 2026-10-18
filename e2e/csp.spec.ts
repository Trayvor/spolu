import { expect, test, type Page } from '@playwright/test';

/**
 * The enforced Content-Security-Policy (ADR 0044) comes from the app, so this production-like
 * run has it too. The main screens, the realtime connection and the bulk email preview (an
 * `<iframe srcdoc>` that inherits the policy, with the logo image) must cause no violation.
 * Every document reports its `securitypolicyviolation` events (a caught `new Function` probe
 * too, which logs nothing to the console); CSP console messages are caught as well.
 */
async function watchViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeBinding('__cspViolation', (_source, line: string) => void violations.push(line));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const report = (window as unknown as { __cspViolation?: (line: string) => void })
        .__cspViolation;
      report?.(
        `${e.effectiveDirective} blocked ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}`,
      );
    });
  });
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

test('every answer carries the enforced CSP and its report endpoint', async ({ request }) => {
  const res = await request.get('/');
  const policy = res.headers()['content-security-policy'] ?? '';
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self';");
  expect(policy).toContain('report-uri /api/csp-report');
  expect(res.headers()['content-security-policy-report-only']).toBeUndefined();
  expect(res.headers()['reporting-endpoints']).toMatch(/^csp="http.*\/api\/csp-report"$/);
});

test('the main screens run under the CSP without a violation', async ({ page }) => {
  test.setTimeout(90_000);
  const violations = await watchViolations(page);

  // Settings: the Socket.IO connection (connect-src ws://) is up.
  await page.goto('/settings');
  await expect(page.getByText('Realtime: pripojené')).toBeVisible({ timeout: 15_000 });

  for (const path of ['/', '/groups', '/tasks', '/tickets', '/knowledge', '/admins']) {
    await page.goto(path);
    await expect(page.getByRole('link', { name: 'Help by eGrant' })).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
  }

  // The bulk email editor and its preview frame (inline email styles, the logo image).
  await page.goto('/bulk-email');
  await page.getByRole('button', { name: 'Nový e-mail' }).click();
  await expect(page).toHaveURL(/\/bulk-email\/[0-9a-f-]{36}$/);
  await page.getByLabel('Interný názov').fill(`E2E CSP ${Date.now()}`);
  const add = page.getByRole('group', { name: 'Pridať blok', exact: true });
  await add.getByRole('button', { name: 'Text', exact: true }).click();
  await page
    .getByRole('list', { name: 'Bloky' })
    .getByRole('textbox', { name: 'Text' })
    .first()
    .fill('CSP **náhľad**');
  await add.getByRole('button', { name: 'Logo eGrant', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Náhľad e-mailu"]');
  await expect(frame.getByText('náhľad')).toBeVisible();
  // The logo is an image on this origin: it loads (img-src 'self'), not blocked.
  const logo = frame.locator('img[alt="eGrant"]');
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  expect(violations).toEqual([]);
});
