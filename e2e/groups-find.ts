import type { Locator, Page } from '@playwright/test';

/**
 * The "Nájsť klienta" field of the Groups page. From 1024 px the admin's client sidebar
 * (`nav` "Klienti") has a field with the same name, so the sidebar's one is left out.
 */
export function groupsFind(page: Page): Locator {
  return page
    .getByRole('searchbox', { name: 'Nájsť klienta' })
    .locator('xpath=self::*[not(ancestor::nav)]');
}
