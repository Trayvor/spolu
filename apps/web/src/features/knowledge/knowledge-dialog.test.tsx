import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FileInfo, GroupPerson, KnowledgeItemDto, Me } from '@spolu/shared';
import { ApiError } from '@/lib/api';
import { i18n } from '@/i18n';
import { createKnowledge, deleteKnowledge, updateKnowledge } from './api';
import { KnowledgeDialog } from './knowledge-dialog';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  createKnowledge: vi.fn(),
  updateKnowledge: vi.fn(),
  deleteKnowledge: vi.fn(async () => undefined),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const ME: Me = {
  id: 'u2',
  email: 'b@example.com',
  name: 'Boris Kováč',
  role: 'admin',
  groupId: null,
};
const PEOPLE: GroupPerson[] = [
  { id: 'u1', name: 'Anna Nováková', isAdmin: false },
  { id: 'u2', name: 'Boris Kováč', isAdmin: true },
];
const PDF: FileInfo = {
  id: 'f1',
  name: 'checklist.pdf',
  mime: 'application/pdf',
  size: 120_000,
  width: null,
  height: null,
  hasPreview: false,
};

function item(overrides: Partial<KnowledgeItemDto> = {}): KnowledgeItemDto {
  return {
    id: 'k1',
    groupId: 'g1',
    type: 'note',
    visibility: 'public',
    title: 'Grant checklist',
    excerpt: '',
    url: null,
    file: null,
    fileCount: 0,
    nextReminderAt: null,
    upcomingCount: 0,
    lastReminderAt: null,
    createdBy: { id: 'u1', name: 'Anna Nováková' },
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    body: 'Check the **budget table**',
    files: [],
    reminder: null,
    canEdit: true,
    visibilityLocked: true,
    ...overrides,
  };
}

let current: KnowledgeItemDto | 'missing' = item();

beforeEach(() => {
  current = item();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/people')) return new Response(JSON.stringify(PEOPLE), { status: 200 });
      if (url.includes('/knowledge/')) {
        return current === 'missing'
          ? new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
          : new Response(JSON.stringify(current), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

type Target = Parameters<typeof KnowledgeDialog>[0]['target'];

function renderDialog(target: Target = { mode: 'view', id: 'k1' }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['session'], ME);
  const onClose = vi.fn();
  const onUnavailable = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <KnowledgeDialog target={target} onClose={onClose} onUnavailable={onUnavailable} />
    </QueryClientProvider>,
  );
  return { client, onClose, onUnavailable };
}

const heading = (name: string) => screen.findByRole('heading', { name });

describe('KnowledgeDialog', () => {
  it('view shows the note body rendered and its files', async () => {
    current = item({ files: [PDF], fileCount: 1 });
    renderDialog();
    await heading('Grant checklist');
    expect(screen.getByText('budget table').tagName).toBe('STRONG');
    expect(
      screen.getByRole('link', { name: t('files.download', { name: 'checklist.pdf' }) }),
    ).toBeInTheDocument();
    expect(screen.getByText(t('knowledge.visibility.public'))).toBeInTheDocument();
  });

  it('file item shows a full-width download chip', async () => {
    current = item({ type: 'file', file: PDF, files: [PDF], body: 'The signed form' });
    renderDialog();
    await heading('Grant checklist');
    const chip = screen.getByRole('link', { name: t('files.download', { name: 'checklist.pdf' }) });
    expect(chip).toHaveClass('w-full');
    expect(screen.getByText('The signed form')).toBeInTheDocument();
  });

  it('link shows the URL with Open link for screen readers', async () => {
    current = item({ type: 'link', url: 'https://egrant.sk/calls', body: '' });
    renderDialog();
    await heading('Grant checklist');
    const link = screen.getByRole('link', { name: new RegExp(t('knowledge.detail.openLink')) });
    expect(link).toHaveAttribute('href', 'https://egrant.sk/calls');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveTextContent('https://egrant.sk/calls');
  });

  it('Edit and More only when canEdit', async () => {
    current = item({ canEdit: false });
    renderDialog();
    await heading('Grant checklist');
    expect(screen.queryByRole('button', { name: t('knowledge.detail.edit') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('knowledge.detail.more') })).toBeNull();
  });

  it('edit, save sends the patch and returns to view', async () => {
    const saved = item({ title: 'Grant checklist v2', updatedAt: '2026-10-15T10:00:00.000Z' });
    vi.mocked(updateKnowledge).mockResolvedValue(saved);
    const user = userEvent.setup();
    const { client } = renderDialog();
    await heading('Grant checklist');
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.edit') }));
    const title = screen.getByLabelText(t('knowledge.form.title'));
    await user.type(title, ' v2');
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.save') }));
    expect(updateKnowledge).toHaveBeenCalledWith('k1', {
      title: 'Grant checklist v2',
      updatedAt: '2026-10-14T10:00:00.000Z',
    });
    await heading('Grant checklist v2');
    expect(client.getQueryData(['knowledge', 'item', 'k1'])).toEqual(saved);
  });

  it('409 shows the reload notice', async () => {
    vi.mocked(updateKnowledge).mockRejectedValue(
      new ApiError('conflict', 409, { error: 'knowledge_changed' }),
    );
    const user = userEvent.setup();
    renderDialog();
    await heading('Grant checklist');
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.edit') }));
    await user.type(screen.getByLabelText(t('knowledge.form.title')), ' v2');
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.save') }));
    const notice = await screen.findByText(t('knowledge.detail.changed'));
    expect(
      within(notice.closest('[role=alert]') as HTMLElement).getByRole('button', {
        name: t('knowledge.detail.reload'),
      }),
    ).toBeInTheDocument();
  });

  it('delete asks inline and calls deleteKnowledge', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await heading('Grant checklist');
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('knowledge.detail.delete') }));
    expect(deleteKnowledge).not.toHaveBeenCalled();
    const bar = screen.getByText(t('knowledge.detail.deleteConfirm')).closest('[role=alert]');
    await user.click(
      within(bar as HTMLElement).getByRole('button', { name: t('knowledge.detail.delete') }),
    );
    expect(deleteKnowledge).toHaveBeenCalledWith('k1');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('create posts the draft and closes with the new id', async () => {
    vi.mocked(createKnowledge).mockResolvedValue(item({ id: 'k9', title: 'Opening hours' }));
    const user = userEvent.setup();
    const { onClose } = renderDialog({ mode: 'create', type: 'note', groupId: 'g1' });
    await heading(t('knowledge.detail.new.note'));
    await user.type(screen.getByLabelText(t('knowledge.form.title')), 'Opening hours');
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.create') }));
    expect(createKnowledge).toHaveBeenCalledWith('g1', {
      type: 'note',
      title: 'Opening hours',
      body: '',
      visibility: 'public',
      fileIds: [],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('k9'));
  });

  it('closing an untouched draft does not ask', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ mode: 'create', type: 'link', groupId: 'g1' });
    await heading(t('knowledge.detail.new.link'));
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.cancel') }));
    expect(screen.queryByText(t('knowledge.detail.discardDraft'))).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('closing a typed draft asks first', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ mode: 'create', type: 'link', groupId: 'g1' });
    await heading(t('knowledge.detail.new.link'));
    await user.type(screen.getByLabelText(t('knowledge.form.title')), 'Calls');
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.cancel') }));
    expect(screen.getByText(t('knowledge.detail.discardDraft'))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.discard') }));
    expect(onClose).toHaveBeenCalled();
  });

  it('404 calls onUnavailable', async () => {
    current = 'missing';
    const { onUnavailable } = renderDialog();
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
  });

  it('reminder_in_past marks the times field', async () => {
    const at = new Date(Date.now() + 48 * 3_600_000).toISOString();
    current = item({
      type: 'reminder',
      reminder: {
        times: [{ id: 't1', at, firedAt: null }],
        recipients: [{ user: { id: 'u1', name: 'Anna Nováková' }, source: 'author' }],
        subscribed: false,
        canEdit: true,
      },
    });
    vi.mocked(updateKnowledge).mockRejectedValue(
      new ApiError('past', 400, { error: 'reminder_in_past' }),
    );
    const user = userEvent.setup();
    renderDialog();
    await heading('Grant checklist');
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.edit') }));
    await user.type(screen.getByLabelText(t('knowledge.form.title')), ' v2');
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.save') }));
    expect(await screen.findByText(t('reminders.fields.errors.passed'))).toBeInTheDocument();
  });
  it('focuses the title after loading, after Edit and after Cancel', async () => {
    const user = userEvent.setup();
    renderDialog();
    const title = await heading('Grant checklist');
    await waitFor(() => expect(title).toHaveFocus());
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.edit') }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Grant checklist' })).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: t('knowledge.detail.cancel') }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Grant checklist' })).toHaveFocus(),
    );
  });
});
