import type { BrowserContext } from '@playwright/test';

/**
 * Makes `/api/me` report the given phone navigation for this browser context only. The
 * superadmin account is shared by parallel specs, so the preference is not written to the
 * server: "Classic" (the default) shows the section select in the header, "bottom" the bar.
 */
export async function phoneNavigation(
  context: BrowserContext,
  phoneNav: 'classic' | 'bottom',
): Promise<void> {
  await context.route(
    (url) => url.pathname === '/api/me',
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      const me = (await response.json()) as Record<string, unknown>;
      return route.fulfill({ response, json: { ...me, phoneNav } });
    },
  );
}
