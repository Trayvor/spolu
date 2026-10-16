import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkBlock, BulkCampaignDto } from '@spolu/shared';
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
const SENDER = 'eGrant <info@egrant.sk>';

const blocks: BulkBlock[] = [{ id: 't', type: 'text', text: 'Hello {{name}}', align: 'left' }];

/** GET answers `current`; PUT saves into it; POST /send answers `onSend` (default: sending). */
function routes(initial: Partial<BulkCampaignDto>, onSend?: () => Response): Route[] {
  let current = campaign({ subject: 'News of October', blocks, ...initial });
  return [
    (url, init) => {
      if (url.pathname === `${PATH}/send` && init.method === 'POST') {
        if (onSend) return onSend();
        current = {
          ...current,
          status: 'sending',
          sender: SENDER,
          recipientCount: 248,
          sendStartedAt: '2026-10-16T10:05:00.000Z',
          sentByName: 'Ada',
        };
        return reply(200, current);
      }
      if (url.pathname === `${PATH}/recipients`) return reply(200, { items: [], nextCursor: null });
      if (url.pathname !== PATH) return undefined;
      if (init.method === 'PUT') {
        const body = JSON.parse(init.body as string) as BulkCampaignDto;
        current = { ...current, ...body, version: current.version + 1 };
      }
      return reply(200, current);
    },
    (url) =>
      url.pathname === '/api/bulk-email/sender' ? reply(200, { sender: SENDER }) : undefined,
    (url) =>
      url.pathname === '/api/bulk-email/audience/count'
        ? reply(200, { count: 248, leftOut: { unsubscribed: 0, disabled: 0 } })
        : undefined,
  ];
}

async function openEditor(initial: Partial<BulkCampaignDto> = {}, onSend?: () => Response) {
  const api = mockBulkApi(ADMIN, routes(initial, onSend));
  const view = renderAt('/bulk-email/k1');
  await screen.findByRole('heading', { name: 'Campaign k1' });
  return { ...api, ...view };
}

const openDialog = async (user: ReturnType<typeof renderAt>['user']) => {
  await user.click(screen.getByRole('button', { name: t('bulkEmail.send.open') }));
  return screen.findByTestId('send-dialog');
};

describe('bulk email send step', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    socket.current?.reset();
  });

  it('send dialog shows subject, sender and the live count', async () => {
    const { user } = await openEditor();
    const dialog = await openDialog(user);
    expect(
      await within(dialog).findByRole('heading', { name: 'Send to 248 people?' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('News of October')).toBeInTheDocument();
    expect(await within(dialog).findByText(SENDER)).toBeInTheDocument();
    expect(within(dialog).getByText('248 people')).toBeInTheDocument();
  });

  it('saves a pending edit before the dialog opens', async () => {
    const { user, callsTo } = await openEditor();
    const subject = screen.getByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'Fresh subject');
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText('Fresh subject')).toBeInTheDocument();
    const puts = callsTo('PUT', PATH);
    expect(puts.length).toBeGreaterThan(0);
    expect(puts.at(-1)!.body).toMatchObject({ subject: 'Fresh subject' });
  });

  it('confirm posts send and shows the report', async () => {
    const { user, callsTo } = await openEditor();
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: 'Send to 248 people' }));
    expect(callsTo('POST', `${PATH}/send`)).toHaveLength(1);
    expect(await screen.findByText(t('bulkEmail.report.note'))).toBeInTheDocument();
    expect(screen.queryByTestId('send-dialog')).toBeNull();
    expect(screen.queryByLabelText('Subject')).toBeNull();
  });

  it('not_ready closes the dialog and shows the problems at their block', async () => {
    const { user } = await openEditor({}, () =>
      reply(400, {
        error: 'not_ready',
        problems: [{ blockId: 't', problem: 'invalid_url' }, { problem: 'subject_missing' }],
      }),
    );
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: 'Send to 248 people' }));
    await waitFor(() => expect(screen.queryByTestId('send-dialog')).toBeNull());
    const block = screen.getByTestId('block-t');
    expect(within(block).getByText(t('bulkEmail.notReady.invalid_url'))).toBeInTheDocument();
    expect(screen.getByText(t('bulkEmail.notReady.subject_missing'))).toBeInTheDocument();
    expect(screen.getByText(t('bulkEmail.send.notReady'))).toBeInTheDocument();
  });

  it('empty_audience is told in the dialog', async () => {
    const { user } = await openEditor({}, () => reply(400, { error: 'empty_audience' }));
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: 'Send to 248 people' }));
    expect(await within(dialog).findByText(t('bulkEmail.send.emptyAudience'))).toBeInTheDocument();
  });

  it('not_draft is told in the dialog with a way to the report', async () => {
    const { user } = await openEditor({}, () => reply(409, { error: 'not_draft' }));
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: 'Send to 248 people' }));
    expect(await within(dialog).findByText(t('bulkEmail.send.notDraft'))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t('bulkEmail.send.reload') })).toBeVisible();
  });

  it('Not now closes the dialog without sending', async () => {
    const { user, callsTo } = await openEditor();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: t('bulkEmail.send.cancel') }));
    expect(screen.queryByTestId('send-dialog')).toBeNull();
    expect(callsTo('POST', `${PATH}/send`)).toHaveLength(0);
  });
});
