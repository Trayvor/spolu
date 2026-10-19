import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n, setLanguage } from '@/i18n';
import { mockBulkApi, renderAt, reply } from '@/features/bulk-email/test-api';

const PATH = '/api/weekly-summary/unsubscribe/tok.en.sig';
const info =
  (language = 'sk') =>
  (url: URL, init: RequestInit) =>
    url.pathname === PATH && (init.method ?? 'GET') === 'GET'
      ? reply(200, { groupName: 'Firma A', language, subscribed: true })
      : undefined;

describe('the weekly summary unsubscribe page', () => {
  beforeEach(async () => {
    await setLanguage('sk');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the group and unsubscribes on open', async () => {
    const { callsTo } = mockBulkApi(null, [
      info(),
      (url, init) => (url.pathname === PATH && init.method === 'POST' ? reply(200, {}) : undefined),
    ]);
    renderAt('/weekly-summary/unsubscribe/tok.en.sig');
    expect(
      await screen.findByText('Odhlásili ste sa z týždenného prehľadu skupiny Firma A.'),
    ).toBeInTheDocument();
    expect(callsTo('POST', PATH)).toHaveLength(1);
  });

  it('Znova prihlásiť subscribes again', async () => {
    const { callsTo } = mockBulkApi(null, [
      info(),
      (url, init) => (url.pathname === PATH && init.method === 'POST' ? reply(200, {}) : undefined),
      (url) =>
        url.pathname === '/api/weekly-summary/subscribe/tok.en.sig' ? reply(200, {}) : undefined,
    ]);
    const { user } = renderAt('/weekly-summary/unsubscribe/tok.en.sig');
    await user.click(await screen.findByRole('button', { name: 'Znova prihlásiť' }));
    expect(
      await screen.findByText('Týždenný prehľad skupiny Firma A vám bude opäť chodiť.'),
    ).toBeInTheDocument();
    expect(callsTo('POST', '/api/weekly-summary/subscribe/tok.en.sig')).toHaveLength(1);
  });

  it('a bad link shows Odkaz je neplatný alebo už neplatí.', async () => {
    mockBulkApi(null, []);
    renderAt('/weekly-summary/unsubscribe/bad');
    expect(await screen.findByText('Odkaz je neplatný alebo už neplatí.')).toBeInTheDocument();
  });

  it("the page is in the token's language", async () => {
    mockBulkApi(null, [
      info('en'),
      (url, init) => (url.pathname === PATH && init.method === 'POST' ? reply(200, {}) : undefined),
    ]);
    renderAt('/weekly-summary/unsubscribe/tok.en.sig');
    expect(
      await screen.findByText('You unsubscribed from the weekly summary of Firma A.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(i18n.language).toBe('en'));
  });
});
