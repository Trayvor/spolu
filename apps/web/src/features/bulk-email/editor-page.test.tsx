import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
const resize = vi.hoisted(() => vi.fn());
vi.mock('@/lib/resize-image', () => ({ resizeImageWithSize: resize }));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const PATH = '/api/bulk-email/campaigns/k1';

/** The campaign route: GET answers `current`, PUT saves into it with the next version. */
function campaignRoutes(initial: Partial<BulkCampaignDto> = {}, put?: Route) {
  let current = campaign(initial);
  const route: Route = (url, init) => {
    if (url.pathname !== PATH) return undefined;
    if (init.method === 'PUT') {
      if (put) {
        const answer = put(url, init);
        if (answer) return answer;
      }
      const body = JSON.parse(init.body as string) as BulkCampaignDto;
      current = { ...current, ...body, version: current.version + 1 };
      return reply(200, current);
    }
    return reply(200, current);
  };
  return {
    route,
    set: (over: Partial<BulkCampaignDto>) => (current = { ...current, ...over }),
  };
}

const blocks = (): BulkBlock[] => [
  { id: 'h', type: 'heading', text: 'Hello {{name}}', align: 'left' },
  {
    id: 't',
    type: 'text',
    align: 'left',
    content: [{ type: 'paragraph', content: [{ text: 'Body' }] }],
  },
  { id: 'd', type: 'divider' },
];
const blockTitles = () =>
  within(screen.getByRole('list', { name: t('bulkEmail.blocks.title') }))
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent);

async function openEditor(
  initial: Partial<BulkCampaignDto> = {},
  routes: Route[] = [],
  put?: Route,
) {
  const c = campaignRoutes(initial, put);
  const api = mockBulkApi(ADMIN, [c.route, ...routes]);
  const view = renderAt('/bulk-email/k1');
  await screen.findByRole('heading', { name: initial.name ?? 'Campaign k1' });
  return { ...api, ...view, campaign: c };
}

describe('bulk email editor', () => {
  beforeEach(async () => {
    await setLanguage('en');
    resize.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    socket.current?.reset();
  });

  it('adds each block type', async () => {
    const { user } = await openEditor();
    expect(screen.getByText(t('bulkEmail.blocks.empty'))).toBeInTheDocument();
    const add = screen.getByRole('group', { name: 'Add block' });
    const names = [
      'Heading',
      'Text',
      'Image',
      'Button',
      'Divider',
      'Space',
      'eGrant logo',
      'Split container',
    ];
    for (const name of names) {
      await user.click(within(add).getByRole('button', { name }));
    }
    expect(blockTitles()).toEqual(names);
  });

  it('a split container takes blocks on either side and they move between sides', async () => {
    const { user } = await openEditor({ blocks: blocks() });
    await user.click(
      within(screen.getByRole('group', { name: 'Add block' })).getByRole('button', {
        name: 'Split container',
      }),
    );
    const left = screen.getByRole('region', { name: 'Left column of block 4' });
    await user.click(
      within(
        within(left).getByRole('group', { name: 'Add block to Left column of block 4' }),
      ).getByRole('button', { name: 'Button' }),
    );
    expect(within(left).getByRole('heading', { name: 'Button', level: 3 })).toBeInTheDocument();
    // The heading of the main list goes into the right column.
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Move block 1 (Heading) to…' }),
      'Right column of block 4',
    );
    const right = screen.getByRole('region', { name: 'Right column of block 3' });
    expect(within(right).getByRole('heading', { name: 'Heading', level: 3 })).toBeInTheDocument();
    expect(blockTitles()[0]).toBe('Text');
  });

  it('Phone mode: follows desktop until the first edit, then is separate until Return', async () => {
    const { user, callsTo } = await openEditor({ blocks: blocks() });
    const state = screen.getByTestId('phone-version-state');
    expect(state).toHaveTextContent(t('bulkEmail.mode.follows'));
    await user.click(screen.getByRole('button', { name: 'Phone' }));
    expect(blockTitles()).toEqual(['Heading', 'Text', 'Divider']);
    await user.click(screen.getByRole('button', { name: 'Delete block 3 (Divider)' }));
    expect(state).toHaveTextContent(t('bulkEmail.mode.separate'));
    expect(blockTitles()).toEqual(['Heading', 'Text']);
    await waitFor(() => expect(callsTo('PUT', PATH)).toHaveLength(1), { timeout: 3000 });
    expect(callsTo('PUT', PATH)[0]!.body).toMatchObject({
      blocks: blocks(),
      phoneBlocks: blocks().slice(0, 2),
    });

    // Desktop is untouched, and its edits do not reach the phone version.
    await user.click(screen.getByRole('button', { name: 'Computer' }));
    expect(blockTitles()).toEqual(['Heading', 'Text', 'Divider']);
    await user.click(screen.getByRole('button', { name: 'Delete block 1 (Heading)' }));
    await user.click(screen.getByRole('button', { name: 'Phone' }));
    expect(blockTitles()).toEqual(['Heading', 'Text']);

    await user.click(screen.getByRole('button', { name: t('bulkEmail.mode.return') }));
    await user.click(screen.getByRole('button', { name: t('bulkEmail.mode.returnYes') }));
    expect(state).toHaveTextContent(t('bulkEmail.mode.follows'));
    expect(blockTitles()).toEqual(['Text', 'Divider']);
    await waitFor(
      () => expect(callsTo('PUT', PATH).at(-1)!.body).toMatchObject({ phoneBlocks: null }),
      { timeout: 3000 },
    );
  });

  it('opens a saved separate phone version as separate', async () => {
    await openEditor({ blocks: blocks(), phoneBlocks: [{ id: 'd', type: 'divider' }] });
    expect(screen.getByTestId('phone-version-state')).toHaveTextContent(
      t('bulkEmail.mode.separate'),
    );
  });

  it('moves blocks up and down; the first has no Move up and the last no Move down', async () => {
    const { user } = await openEditor({ blocks: blocks() });
    expect(screen.queryByRole('button', { name: 'Move block 1 (Heading) up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move block 3 (Divider) down' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Move block 1 (Heading) down' }));
    expect(blockTitles()).toEqual(['Text', 'Heading', 'Divider']);
    await user.click(screen.getByRole('button', { name: 'Move block 3 (Divider) up' }));
    expect(blockTitles()).toEqual(['Text', 'Divider', 'Heading']);
    await user.click(screen.getByRole('button', { name: 'Delete block 1 (Text)' }));
    expect(blockTitles()).toEqual(['Divider', 'Heading']);
  });

  it('autosaves once, 1 s after the last change, with the version read last', async () => {
    const { user, callsTo } = await openEditor({ blocks: blocks() });
    await user.type(screen.getByLabelText('Subject'), ' you');
    await waitFor(() => expect(callsTo('PUT', PATH)).toHaveLength(1), { timeout: 3000 });
    const first = callsTo('PUT', PATH)[0]!.body as { subject: string; version: number };
    expect(first).toMatchObject({ subject: 'Hello you', version: 3 });
    expect(await screen.findByText(t('bulkEmail.save.saved'))).toBeInTheDocument();

    await user.type(screen.getByLabelText('Subject'), '!');
    await waitFor(() => expect(callsTo('PUT', PATH)).toHaveLength(2), { timeout: 3000 });
    expect(callsTo('PUT', PATH)[1]!.body).toMatchObject({ subject: 'Hello you!', version: 4 });
  });

  it('does not save a draft with problems and marks the field', async () => {
    const { user, callsTo } = await openEditor({
      blocks: [{ id: 'b', type: 'button', label: 'Go', url: 'https://egrant.sk', align: 'left' }],
    });
    const url = screen.getByLabelText('Link');
    await user.clear(url);
    await user.type(url, 'javascript:alert(1)');
    expect(await screen.findByText(t('bulkEmail.save.invalid'))).toBeInTheDocument();
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(t('bulkEmail.problems.invalidUrl'))).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1200));
    expect(callsTo('PUT', PATH)).toHaveLength(0);
  });

  it('409 changed shows the reload prompt and Reload loads the other edit', async () => {
    let conflict = true;
    const {
      user,
      callsTo,
      campaign: c,
    } = await openEditor({}, [], () => (conflict ? reply(409, { error: 'changed' }) : undefined));
    await user.type(screen.getByLabelText('Subject'), ' mine');
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent(t('bulkEmail.save.changed'));

    // Nothing more is sent: the other admin's edit is not overwritten.
    await user.type(screen.getByLabelText('Subject'), '!');
    await new Promise((r) => setTimeout(r, 1200));
    expect(callsTo('PUT', PATH)).toHaveLength(1);

    conflict = false;
    c.set({ subject: 'Theirs', version: 9 });
    await user.click(within(alert).getByRole('button', { name: t('bulkEmail.save.reload') }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Theirs'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the preview in a sandboxed iframe and switches between 720 and 375 px', async () => {
    const { user, callsTo } = await openEditor({ blocks: blocks() });
    const frame = await screen.findByTitle(t('bulkEmail.preview.frame'));
    // No scripts, popups or forms; same origin only so the editor can outline blocks.
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    await waitFor(() => expect(frame).toHaveAttribute('srcdoc', '<p>Preview</p>'));
    expect(frame).toHaveAttribute('width', '720');
    await user.click(screen.getByRole('button', { name: 'Phone' }));
    expect(frame).toHaveAttribute('width', '375');
    expect(screen.getByRole('button', { name: 'Phone' })).toHaveAttribute('aria-pressed', 'true');
    const [preview] = callsTo('POST', `${PATH}/preview`);
    expect(preview!.body).toMatchObject({ subject: 'Hello', blocks: blocks() });
  });

  it('shrinks an image to 1 200 px JPEG before the upload', async () => {
    const shrunk = new Blob(['jpeg'], { type: 'image/jpeg' });
    resize.mockResolvedValue({ blob: shrunk, width: 3000, height: 2000 });
    const { user, callsTo } = await openEditor({}, [
      (url, init) =>
        url.pathname === '/api/bulk-email/images' && init.method === 'POST'
          ? reply(201, {
              id: 'img1',
              url: 'https://x/api/bulk-email/images/img1',
              width: 1200,
              height: 800,
            })
          : undefined,
    ]);
    await user.click(screen.getByRole('button', { name: 'Image' }));
    const block = screen.getByRole('list', { name: t('bulkEmail.blocks.title') });
    const file = new File(['x'], 'photo.webp', { type: 'image/webp' });
    fireEvent.change(within(block).getByLabelText(t('bulkEmail.fields.upload')), {
      target: { files: [file] },
    });
    await waitFor(() => expect(callsTo('POST', '/api/bulk-email/images')).toHaveLength(1));
    expect(resize).toHaveBeenCalledWith(file, 1200, { outputType: 'image/jpeg', fit: 'width' });
    const [upload] = callsTo('POST', '/api/bulk-email/images');
    expect(upload!.init.body).toBe(shrunk);
    expect((upload!.init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
    expect(
      await screen.findByRole('button', { name: t('bulkEmail.fields.replace') }),
    ).toBeInTheDocument();
    expect(block.querySelector('img')).toHaveAttribute('src', '/api/bulk-email/images/img1');
  });

  it('Send a test to me posts and tells where it went', async () => {
    const { user, callsTo } = await openEditor({ blocks: blocks() }, [
      (url) => (url.pathname === `${PATH}/test` ? reply(202, { ok: true }) : undefined),
    ]);
    await user.click(screen.getByRole('button', { name: t('bulkEmail.test.send') }));
    expect(await screen.findByText('Test sent to ada@egrant.sk.')).toBeInTheDocument();
    expect(callsTo('POST', `${PATH}/test`)).toHaveLength(1);
  });

  it('hides Send a test when the route does not exist yet (generic 404)', async () => {
    const { user } = await openEditor({ blocks: blocks() }, [
      (url) =>
        url.pathname === `${PATH}/test`
          ? reply(404, {
              message: 'Route POST:/api/x not found',
              error: 'Not Found',
              statusCode: 404,
            })
          : undefined,
    ]);
    await user.click(screen.getByRole('button', { name: t('bulkEmail.test.send') }));
    expect(await screen.findByText(t('bulkEmail.test.unavailable'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('bulkEmail.test.send') })).toBeNull();
  });

  it('shows not_ready problems at their block', async () => {
    const { user } = await openEditor({ blocks: blocks() }, [
      (url) =>
        url.pathname === `${PATH}/test`
          ? reply(400, {
              error: 'not_ready',
              problems: [{ blockId: 't', problem: 'invalid_url' }, { problem: 'subject_missing' }],
            })
          : undefined,
    ]);
    await user.click(screen.getByRole('button', { name: t('bulkEmail.test.send') }));
    const block = await screen.findByTestId('block-t');
    expect(await within(block).findByText(t('bulkEmail.notReady.invalid_url'))).toBeInTheDocument();
    expect(block).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(t('bulkEmail.notReady.subject_missing'))).toBeInTheDocument();
  });

  it('a sent campaign is read-only with Duplicate', async () => {
    const { user, router } = await openEditor({ status: 'sent', name: 'Sent one' }, [
      (url, init) =>
        url.pathname === `${PATH}/duplicate` && init.method === 'POST'
          ? reply(201, campaign({ id: 'k2', name: 'Sent one (copy)' }))
          : undefined,
      (url) =>
        url.pathname === '/api/bulk-email/campaigns/k2'
          ? reply(200, campaign({ id: 'k2', name: 'Sent one (copy)' }))
          : undefined,
    ]);
    expect(screen.queryByLabelText('Subject')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/bulk-email/k2'));
    expect(await screen.findByRole('heading', { name: 'Sent one (copy)' })).toBeInTheDocument();
  });

  it('takes another admin’s newer version when nothing waits to be saved', async () => {
    const { campaign: c } = await openEditor();
    c.set({ subject: 'Changed elsewhere', version: 7 });
    act(() => socket.current!.fire('bulk:updated', { campaignId: 'k1' }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('Changed elsewhere'));
  });
});
