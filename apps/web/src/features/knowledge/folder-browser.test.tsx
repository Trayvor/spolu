import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { KnowledgeFolderDto } from '@spolu/shared';
import { i18n } from '@/i18n';
import { deleteFolder, updateFolder } from './api';
import { FolderBrowser } from './folder-browser';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(async () => undefined),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const folder = (id: string, name: string, parentId: string | null): KnowledgeFolderDto => ({
  id,
  groupId: 'g1',
  parentId,
  name,
  visibility: 'public',
  updatedAt: '',
});
const FOLDERS = [
  folder('a', 'Grants', null),
  folder('b', 'Old', 'a'),
  folder('c', 'Older', 'b'),
  folder('d', 'Archive', null),
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/folders')
        ? new Response(JSON.stringify({ folders: FOLDERS }))
        : new Response(JSON.stringify({ items: [], nextCursor: null })),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderBrowser(folderId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenFolder = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <FolderBrowser
        groupId="g1"
        folderId={folderId}
        types={[]}
        rootCrumbs={[{ key: 'top', label: 'Knowledge' }]}
        onOpenFolder={onOpenFolder}
        onOpenItem={vi.fn()}
        onFolderGone={vi.fn()}
        canSeeAdmins
        emptyHint={<p>Empty</p>}
      />
    </QueryClientProvider>,
  );
  return { onOpenFolder, user: userEvent.setup() };
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(
    await screen.findByRole('button', { name: t('knowledge.folders.more', { name }) }),
  );
};

describe('FolderBrowser', () => {
  it('lists the folders of the level by name and opens one', async () => {
    const { onOpenFolder, user } = renderBrowser();
    const rows = await screen.findAllByRole('button', { name: /^Open folder|^Otvoriť priečinok/ });
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      t('knowledge.folders.open', { name: 'Archive' }),
      t('knowledge.folders.open', { name: 'Grants' }),
    ]);
    await user.click(rows[1]!);
    expect(onOpenFolder).toHaveBeenCalledWith('a');
  });

  it('Move to… cannot pick the folder itself or anything below it', async () => {
    vi.mocked(updateFolder).mockResolvedValue(folder('a', 'Grants', 'd'));
    const { user } = renderBrowser();
    await openMenu(user, 'Grants');
    await user.click(await screen.findByRole('menuitem', { name: t('knowledge.folders.moveTo') }));
    const picker = await screen.findByTestId('move-dialog');
    for (const name of ['Grants', 'Old', 'Older']) {
      expect(within(picker).getByRole('radio', { name: new RegExp(`^${name}($| )`) })).toBeDisabled();
    }
    // The current place (the top level) is disabled too.
    expect(
      within(picker).getByRole('radio', { name: new RegExp(t('knowledge.folders.topLevel')) }),
    ).toBeDisabled();
    await user.click(within(picker).getByRole('radio', { name: /^Archive/ }));
    await user.click(within(picker).getByRole('button', { name: t('knowledge.folders.moveHere') }));
    expect(updateFolder).toHaveBeenCalledWith('a', { parentId: 'd' });
  });

  it('Delete asks first and says nothing is deleted', async () => {
    const { user } = renderBrowser();
    await openMenu(user, 'Archive');
    await user.click(await screen.findByRole('menuitem', { name: t('knowledge.folders.delete') }));
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(t('knowledge.folders.deleteConfirm', { name: 'Archive' }));
    await user.click(within(notice).getByRole('button', { name: t('knowledge.folders.delete') }));
    await waitFor(() => expect(deleteFolder).toHaveBeenCalledWith('d'));
  });

  it('Rename saves the new name', async () => {
    vi.mocked(updateFolder).mockResolvedValue(folder('d', 'Archív', null));
    const { user } = renderBrowser();
    await openMenu(user, 'Archive');
    await user.click(await screen.findByRole('menuitem', { name: t('knowledge.folders.rename') }));
    const field = await screen.findByLabelText(t('knowledge.folders.name'));
    await user.clear(field);
    await user.type(field, 'Archív');
    await user.click(screen.getByRole('button', { name: t('knowledge.folders.save') }));
    expect(updateFolder).toHaveBeenCalledWith('d', { name: 'Archív' });
  });
});
