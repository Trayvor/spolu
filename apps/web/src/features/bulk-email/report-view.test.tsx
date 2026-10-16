import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkCampaignDto, BulkRecipientItem } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { ADMIN, campaign, makeSocket, mockBulkApi, renderAt, reply, type Route } from './test-api';

const socket = vi.hoisted(() => ({ current: null as null | ReturnType<typeof makeSocket> }));
vi.mock('@/lib/socket', async () => {
  const { makeSocket: make } = await import('./test-api');
  socket.current = make();
  return { getSocket: () => socket.current, connectSocket: vi.fn(), disconnectSocket: vi.fn() };
});

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const PATH = '/api/bulk-email/campaigns/k1';

const COUNTS = {
  queued: 0,
  sending: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  cancelled: 0,
  unsubscribed: 0,
};
const sending = (over: Partial<BulkCampaignDto> = {}) =>
  campaign({
    status: 'sending',
    subject: 'News of October',
    sender: 'eGrant <info@egrant.sk>',
    recipientCount: 10,
    sendStartedAt: '2026-10-16T10:05:00.000Z',
    sentByName: 'Ada',
    counts: { ...COUNTS, queued: 6, sent: 4 },
    ...over,
  });

const row = (over: Partial<BulkRecipientItem> & { userId: string }): BulkRecipientItem => ({
  name: `Person ${over.userId}`,
  email: `${over.userId}@x.sk`,
  status: 'sent',
  error: null,
  sentAt: '2026-10-16T10:06:00.000Z',
  ...over,
});

function setup(initial: BulkCampaignDto, extra: Route[] = []) {
  let current = initial;
  const rows = [
    row({ userId: 'p1' }),
    row({ userId: 'p2', status: 'failed', error: 'Invalid address', sentAt: null }),
    row({ userId: 'p3', status: 'skipped', error: 'unsubscribed', sentAt: null }),
  ];
  const api = mockBulkApi(ADMIN, [
    ...extra,
    (url) => {
      if (url.pathname !== `${PATH}/recipients`) return undefined;
      const status = url.searchParams.get('status');
      const cursor = url.searchParams.get('cursor');
      if (!status && !cursor) return reply(200, { items: rows.slice(0, 2), nextCursor: 'c2' });
      if (cursor) return reply(200, { items: rows.slice(2), nextCursor: null });
      return reply(200, { items: rows.filter((r) => r.status === status), nextCursor: null });
    },
    (url) => (url.pathname === PATH ? reply(200, current) : undefined),
  ]);
  const view = renderAt('/bulk-email/k1');
  return { ...api, ...view, set: (c: BulkCampaignDto) => (current = c) };
}

describe('bulk email report', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    socket.current?.reset();
  });

  it('shows recipients, sent, failed, skipped, cancelled, unsubscribed and the note', async () => {
    setup(
      sending({
        status: 'sent',
        counts: { ...COUNTS, sent: 6, failed: 1, skipped: 2, cancelled: 0, unsubscribed: 3 },
      }),
    );
    const numbers = await screen.findByRole('list', { name: t('bulkEmail.report.counts') });
    const value = (label: string) =>
      within(numbers).getByText(label).closest('li')!.querySelector('[data-value]')!.textContent;
    expect(value('Recipients')).toBe('10');
    expect(value('Sent')).toBe('6');
    expect(value('Failed')).toBe('1');
    expect(value('Skipped')).toBe('2');
    expect(value('Cancelled')).toBe('0');
    expect(value('Unsubscribed')).toBe('3');
    expect(screen.getByText(t('bulkEmail.report.note'))).toBeInTheDocument();
    expect(screen.getByText(/from eGrant <info@egrant.sk>/)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('progress bar updates on bulk:updated', async () => {
    const { set } = setup(sending());
    const bar = await screen.findByRole('progressbar', {
      name: t('bulkEmail.report.progressLabel'),
    });
    expect(bar).toHaveAttribute('aria-valuenow', '4');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
    set(sending({ counts: { ...COUNTS, queued: 1, sent: 8, failed: 1 } }));
    act(() => socket.current!.fire('bulk:updated', { campaignId: 'k1' }));
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '9'));
    expect(screen.getByText('9 of 10 handled')).toBeInTheDocument();
  });

  it('Cancel sending only while sending, after a confirm', async () => {
    const { user, callsTo, set } = setup(sending(), [
      (url, init) =>
        url.pathname === `${PATH}/cancel` && init.method === 'POST'
          ? reply(
              200,
              sending({ status: 'cancelled', counts: { ...COUNTS, sent: 4, cancelled: 6 } }),
            )
          : undefined,
    ]);
    await user.click(
      await screen.findByRole('button', { name: t('bulkEmail.report.cancelSending') }),
    );
    expect(callsTo('POST', `${PATH}/cancel`)).toHaveLength(0);
    set(sending({ status: 'cancelled', counts: { ...COUNTS, sent: 4, cancelled: 6 } }));
    await user.click(screen.getByRole('button', { name: t('bulkEmail.report.cancelYes') }));
    expect(callsTo('POST', `${PATH}/cancel`)).toHaveLength(1);
    expect(await screen.findByText('Cancelled', { selector: '[data-slot=badge]' })).toBeVisible();
    expect(screen.queryByRole('button', { name: t('bulkEmail.report.cancelSending') })).toBeNull();
  });

  it('a sent campaign has no Cancel sending', async () => {
    setup(sending({ status: 'sent', counts: { ...COUNTS, sent: 10 } }));
    await screen.findByText(t('bulkEmail.report.note'));
    expect(screen.queryByRole('button', { name: t('bulkEmail.report.cancelSending') })).toBeNull();
  });

  it('409 not_sending on cancel tells sending finished', async () => {
    const { user } = setup(sending(), [
      (url) =>
        url.pathname === `${PATH}/cancel` ? reply(409, { error: 'not_sending' }) : undefined,
    ]);
    await user.click(
      await screen.findByRole('button', { name: t('bulkEmail.report.cancelSending') }),
    );
    await user.click(screen.getByRole('button', { name: t('bulkEmail.report.cancelYes') }));
    expect(await screen.findByText(t('bulkEmail.report.notSending'))).toBeInTheDocument();
  });

  it('Duplicate opens the new draft', async () => {
    const { user, router } = setup(sending({ status: 'sent', name: 'Sent one' }), [
      (url, init) =>
        url.pathname === `${PATH}/duplicate` && init.method === 'POST'
          ? reply(201, campaign({ id: 'k2', name: 'Sent one (copy)' }))
          : undefined,
      (url) =>
        url.pathname === '/api/bulk-email/campaigns/k2'
          ? reply(200, campaign({ id: 'k2', name: 'Sent one (copy)' }))
          : undefined,
    ]);
    await user.click(await screen.findByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/bulk-email/k2'));
    expect(await screen.findByRole('heading', { name: 'Sent one (copy)' })).toBeInTheDocument();
  });

  it('lists people with status and reason, pages by Show more and filters by status', async () => {
    const { user, callsTo } = setup(sending({ status: 'sent' }));
    const list = await screen.findByRole('list', { name: t('bulkEmail.report.people') });
    expect(await within(list).findByText('Person p1')).toBeInTheDocument();
    expect(within(list).getByText('Invalid address')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('bulkEmail.report.more') }));
    expect(await within(list).findByText('Person p3')).toBeInTheDocument();
    expect(within(list).getByText('Unsubscribed')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(t('bulkEmail.report.filter')), 'failed');
    await waitFor(() => expect(within(list).queryByText('Person p1')).toBeNull());
    expect(within(list).getByText('Person p2')).toBeInTheDocument();
    expect(callsTo('GET', `${PATH}/recipients?status=failed`)).toHaveLength(1);
  });
});
