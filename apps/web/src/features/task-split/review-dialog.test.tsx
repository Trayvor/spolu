import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  FileInfo,
  GroupPerson,
  MessageDto,
  TaskDetailDto,
  TaskProposal,
  TicketDto,
} from '@spolu/shared';
import { ApiError } from '@/lib/api';
import { i18n, setLanguage } from '@/i18n';
import {
  createTasksFromMessage,
  createTasksFromTicket,
  proposeTasks,
  proposeTicketTasks,
} from './split-api';
import { ReviewDialog } from './review-dialog';
import type { SplitSource } from './review-model';

vi.mock('./split-api', () => ({
  proposeTasks: vi.fn(),
  createTasksFromMessage: vi.fn(),
  proposeTicketTasks: vi.fn(),
  createTasksFromTicket: vi.fn(),
}));
vi.mock('@/features/files/upload', () => ({ uploadFile: vi.fn() }));

const propose = vi.mocked(proposeTasks);
const create = vi.mocked(createTasksFromMessage);
const proposeTicket = vi.mocked(proposeTicketTasks);
const createTicket = vi.mocked(createTasksFromTicket);

const PEOPLE: GroupPerson[] = [
  { id: 'u1', name: 'Anna Nováková', isAdmin: false, isManager: false },
];

const FILE: FileInfo = {
  id: 'mf1',
  name: 'invoice.pdf',
  mime: 'application/pdf',
  size: 2048,
  width: null,
  height: null,
  hasPreview: false,
};

const TICKET = {
  id: 'k1',
  number: 123,
  groupId: 'g1',
  subject: 'Cannot submit the application',
  body: 'The form shows an error on the budget step.',
  files: [FILE],
} as unknown as TicketDto;

const MESSAGE: MessageDto = {
  id: 'm1',
  channelId: 'c1',
  parentId: null,
  replyToId: null,
  author: { id: 'u2', name: 'Boris Kováč', isAdmin: true },
  body: 'Send the report and pay the invoice',
  mentions: [],
  mentionsAll: false,
  attachments: [FILE],
  clientId: null,
  replyCount: 0,
  lastReplyAt: null,
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-10-15T10:00:00Z',
  changeSeq: 1,
  tasks: [],
};

const PROPOSALS: TaskProposal[] = [
  {
    title: 'Send the report',
    description: 'The quarterly report to the agency',
    assigneeIds: ['u1'],
    dueDate: '2026-10-20',
    urgent: true,
    messageFileIds: [],
  },
  {
    title: 'Pay the invoice',
    description: '',
    assigneeIds: [],
    dueDate: null,
    urgent: false,
    messageFileIds: ['mf1'],
  },
];

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

function stubWidth(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop && query.includes('min-width: 641px'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function renderDialog(source: SplitSource = { kind: 'message', message: MESSAGE }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(PEOPLE), { status: 200 })),
  );
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewDialog groupId="g1" source={source} onClose={onClose} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onClose, onCreated, queryClient };
}

const articles = () => screen.queryAllByRole('article');
const article = (name: string) => screen.getByRole('article', { name });
const createButton = () => screen.getByRole('button', { name: /^Create \d+ tasks?$/ });

/** Shown in the dialog and announced through the one live region. */
async function expectAnnounced(text: string) {
  await vi.waitFor(() => expect(screen.getByTestId('review-live')).toHaveTextContent(text));
  expect(screen.getAllByText(text)).toHaveLength(2);
}

async function shown() {
  await screen.findByRole('article', { name: 'Send the report' });
}

async function decideBoth(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: t('taskSplit.approveAll') }));
}

describe('ReviewDialog', () => {
  beforeEach(async () => {
    await setLanguage('en');
    propose.mockReset();
    create.mockReset();
    stubWidth(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the review dialog quotes the ticket subject and body', async () => {
    proposeTicket.mockResolvedValue({ tasks: PROPOSALS });
    createTicket.mockResolvedValue([]);
    const { user, onCreated } = renderDialog({ kind: 'ticket', ticket: TICKET });

    const dialog = screen.getByRole('dialog', { name: t('taskSplit.title') });
    expect(within(dialog).getByText('#123 Cannot submit the application')).toBeInTheDocument();
    expect(within(dialog).getByText(TICKET.body!)).toBeInTheDocument();
    expect(proposeTicket).toHaveBeenCalledWith('k1');
    await shown();
    // The ticket's files are offered on the cards like a message's files.
    expect(
      within(article('Pay the invoice')).getByRole('link', {
        name: t('files.download', { name: 'invoice.pdf' }),
      }),
    ).toBeInTheDocument();
    await decideBoth(user);
    await user.click(createButton());
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(createTicket).toHaveBeenCalledWith('g1', {
      ticketId: 'k1',
      tasks: [
        expect.objectContaining({ title: 'Send the report', messageFileIds: [] }),
        expect.objectContaining({ title: 'Pay the invoice', messageFileIds: ['mf1'] }),
      ],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('shows the loading outlines, then compact cards', async () => {
    let resolve!: (value: { tasks: TaskProposal[] }) => void;
    propose.mockReturnValue(new Promise((r) => (resolve = r)));
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: t('taskSplit.title') });
    expect(within(dialog).getByText(MESSAGE.body)).toBeInTheDocument();
    expect(within(dialog).getByText('Boris Kováč')).toBeInTheDocument();
    // One live region, mounted empty and filled after mount, so the change is announced.
    const live = screen.getByTestId('review-live');
    expect(live).toHaveAttribute('role', 'status');
    await vi.waitFor(() => expect(live).toHaveTextContent(t('taskSplit.loading')));
    // While loading, the focus is on the dialog's title.
    expect(screen.getByRole('heading', { name: t('taskSplit.title') })).toHaveFocus();
    expect(screen.getAllByTestId('card-outline')).toHaveLength(3);
    expect(propose).toHaveBeenCalledWith('m1');

    resolve({ tasks: PROPOSALS });
    await shown();
    expect(articles()).toHaveLength(2);
    await vi.waitFor(() =>
      expect(screen.getByTestId('review-live')).toHaveTextContent(
        t('taskSplit.proposed', { count: 2 }),
      ),
    );
    expect(screen.queryByTestId('card-outline')).not.toBeInTheDocument();
    // Compact: no form field until a card is opened.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    const first = article('Send the report');
    expect(within(first).getByText('The quarterly report to the agency')).toHaveClass(
      'line-clamp-2',
    );
    expect(within(first).getByText(t('tasks.card.urgent'))).toBeInTheDocument();
    // The proposed message file shows as a chip on its card.
    expect(
      within(article('Pay the invoice')).getByRole('link', {
        name: t('files.download', { name: 'invoice.pdf' }),
      }),
    ).toBeInTheDocument();
    expect(createButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('desktop: opening a card expands it in place; opening another collapses the first and keeps its edits', async () => {
    propose.mockResolvedValue({ tasks: PROPOSALS });
    const { user } = renderDialog();
    await shown();

    await user.click(
      within(article('Send the report')).getByRole('button', {
        name: t('taskSplit.open', { title: 'Send the report' }),
      }),
    );
    const title = within(article('Send the report')).getByRole('textbox', {
      name: t('tasks.form.title'),
    });
    await user.type(title, ' now');

    await user.click(
      within(article('Pay the invoice')).getByRole('button', {
        name: t('taskSplit.open', { title: 'Pay the invoice' }),
      }),
    );
    expect(screen.getAllByRole('textbox', { name: t('tasks.form.title') })).toHaveLength(1);
    expect(
      within(article('Pay the invoice')).getByRole('textbox', { name: t('tasks.form.title') }),
    ).toHaveValue('Pay the invoice');
    // The proposed message file is in the form and can be removed.
    await user.click(
      screen.getByRole('button', { name: t('forms.files.remove', { name: 'invoice.pdf' }) }),
    );

    await user.click(
      within(article('Send the report now')).getByRole('button', {
        name: t('taskSplit.open', { title: 'Send the report now' }),
      }),
    );
    expect(screen.getByRole('textbox', { name: t('tasks.form.title') })).toHaveValue(
      'Send the report now',
    );
    // The second card kept its edit: the file is gone from its summary.
    expect(
      within(article('Pay the invoice')).queryByRole('link', { name: /invoice\.pdf/ }),
    ).not.toBeInTheDocument();
  });

  it('phone: opening a card shows it full screen with Done, back to the list', async () => {
    stubWidth(false);
    propose.mockResolvedValue({ tasks: PROPOSALS });
    const { user } = renderDialog();
    await shown();

    await user.click(
      screen.getByRole('button', { name: t('taskSplit.open', { title: 'Send the report' }) }),
    );
    const layer = screen.getByRole('region', { name: 'Send the report' });
    expect(articles()).toHaveLength(0);
    await user.type(within(layer).getByRole('textbox', { name: t('tasks.form.title') }), '!');
    await user.click(within(layer).getByRole('button', { name: t('taskSplit.done') }));

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(articles()).toHaveLength(2);
    expect(article('Send the report!')).toBeInTheDocument();
  });

  it('approve, reject, undo; Create is enabled only when every card is decided', async () => {
    propose.mockResolvedValue({ tasks: PROPOSALS });
    const { user } = renderDialog();
    await shown();

    const approve = within(article('Send the report')).getByRole('button', {
      name: t('taskSplit.approve'),
    });
    expect(approve).toHaveAttribute('aria-pressed', 'false');
    await user.click(approve);
    expect(approve).toHaveAttribute('aria-pressed', 'true');
    expect(createButton()).toHaveAttribute('aria-disabled', 'true');
    expect(createButton()).toHaveAccessibleName('Create 1 task');

    await user.click(
      within(article('Pay the invoice')).getByRole('button', { name: t('taskSplit.reject') }),
    );
    // A rejected card is one struck-through line with Undo.
    const rejected = article('Pay the invoice');
    expect(within(rejected).getByText('Pay the invoice')).toHaveClass('line-through');
    expect(within(rejected).queryByRole('button', { name: t('taskSplit.approve') })).toBeNull();
    expect(createButton()).not.toHaveAttribute('aria-disabled', 'true');

    await user.click(within(rejected).getByRole('button', { name: t('taskSplit.undo') }));
    expect(createButton()).toHaveAttribute('aria-disabled', 'true');

    await user.click(screen.getByRole('button', { name: t('taskSplit.approveAll') }));
    expect(createButton()).not.toHaveAttribute('aria-disabled', 'true');
    expect(createButton()).toHaveAccessibleName('Create 2 tasks');
    // "Approve all" is gone: the focus moved to Create.
    expect(screen.queryByRole('button', { name: t('taskSplit.approveAll') })).toBeNull();
    expect(createButton()).toHaveFocus();
  });

  it('approving a card with errors opens it with them instead', async () => {
    propose.mockResolvedValue({ tasks: [{ ...PROPOSALS[0]!, title: '' }, PROPOSALS[1]!] });
    const { user } = renderDialog();
    await screen.findByRole('article', { name: 'Pay the invoice' });

    await decideBoth(user);
    expect(await screen.findByText(t('tasks.form.errors.titleRequired'))).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: t('tasks.form.title') })).toHaveValue('');
    expect(createButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the assignee error and refetches people', async () => {
    propose.mockResolvedValue({ tasks: PROPOSALS });
    create.mockRejectedValueOnce(new ApiError('failed', 400, { error: 'invalid_assignee' }));
    const { user, queryClient } = renderDialog();
    await shown();
    await decideBoth(user);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: /Create 2 tasks/ }));
    await expectAnnounced(t('tasks.form.errors.assigneeNotAllowed'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['groups', 'g1', 'people'] });
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('sends one request on a double click, and keeps the cards when it fails', async () => {
    propose.mockResolvedValue({ tasks: PROPOSALS });
    create.mockRejectedValueOnce(new ApiError('failed', 400, { error: 'invalid_attachment' }));
    const { user, onCreated } = renderDialog();
    await shown();
    await decideBoth(user);

    await user.dblClick(screen.getByRole('button', { name: /Create 2 tasks/ }));
    expect(create).toHaveBeenCalledTimes(1);
    await expectAnnounced(t('taskSplit.filesChanged'));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    // Create was never disabled, so the focus stayed on it.
    expect(createButton()).toHaveFocus();
    expect(onCreated).not.toHaveBeenCalled();
    expect(create.mock.calls[0]).toEqual([
      'g1',
      {
        messageId: 'm1',
        tasks: [
          expect.objectContaining({ title: 'Send the report', fileIds: [], messageFileIds: [] }),
          expect.objectContaining({
            title: 'Pay the invoice',
            fileIds: [],
            messageFileIds: ['mf1'],
          }),
        ],
      },
    ]);
  });

  it('a created set is handed to onCreated; a missing message says so', async () => {
    propose.mockResolvedValue({ tasks: PROPOSALS });
    const tasks = [{ id: 't1' }] as TaskDetailDto[];
    create.mockRejectedValueOnce(new ApiError('gone', 404, { error: 'not_found' }));
    create.mockResolvedValueOnce(tasks);
    const { user, onCreated } = renderDialog();
    await shown();
    await decideBoth(user);

    await user.click(createButton());
    await expectAnnounced(t('taskSplit.messageGone'));
    await user.click(createButton());
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(tasks));
  });

  it('Escape after a decision asks before discarding; a backdrop click does nothing', async () => {
    propose.mockResolvedValue({ tasks: PROPOSALS });
    const { user, onClose } = renderDialog();
    await shown();

    fireEvent.pointerDown(screen.getByTestId('review-backdrop'));
    fireEvent.click(screen.getByTestId('review-backdrop'));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(
      within(article('Send the report')).getByRole('button', { name: t('taskSplit.reject') }),
    );
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(t('taskSplit.discardConfirm'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('taskSplit.keep') }));
    expect(screen.queryByText(t('taskSplit.discardConfirm'))).not.toBeInTheDocument();
    expect(articles()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: t('taskSplit.cancel') }));
    await user.click(screen.getByRole('button', { name: t('taskSplit.discard') }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape while untouched closes at once', async () => {
    propose.mockResolvedValue({ tasks: PROPOSALS });
    const { user, onClose } = renderDialog();
    await shown();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('no tasks: offers one card by hand prefilled with the message text', async () => {
    propose.mockRejectedValue(new ApiError('none', 422, { error: 'ai_no_tasks' }));
    const { user } = renderDialog();

    await expectAnnounced(t('taskSplit.noTasks'));
    await user.click(screen.getByRole('button', { name: t('taskSplit.byHand') }));

    expect(articles()).toHaveLength(1);
    const title = screen.getByRole('textbox', { name: t('tasks.form.title') });
    expect(title).toHaveValue('');
    // The By hand button is gone: the focus is in the new card.
    expect(title).toHaveFocus();
    // The description is the message text (shown rendered until edited).
    expect(within(articles()[0]!).getByText(MESSAGE.body)).toBeInTheDocument();
  });

  it('ai_failed: Try again calls the AI again', async () => {
    propose.mockRejectedValueOnce(new ApiError('bad', 502, { error: 'ai_failed' }));
    propose.mockResolvedValueOnce({ tasks: PROPOSALS });
    const { user } = renderDialog();

    await expectAnnounced(t('taskSplit.failed'));
    await user.click(screen.getByRole('button', { name: t('taskSplit.retry') }));
    await shown();
    expect(propose).toHaveBeenCalledTimes(2);
    // The Try again button is gone: the focus moved to the first card.
    expect(
      screen.getByRole('button', { name: t('taskSplit.open', { title: 'Send the report' }) }),
    ).toHaveFocus();
  });

  it('ai_unavailable: says so, without a retry, and hides the action', async () => {
    propose.mockRejectedValue(new ApiError('off', 503, { error: 'ai_unavailable' }));
    const { queryClient } = renderDialog();
    await expectAnnounced(t('taskSplit.unavailable'));
    expect(screen.queryByRole('button', { name: t('taskSplit.retry') })).not.toBeInTheDocument();
    expect(queryClient.getQueryData(['ai', 'status'])).toMatchObject({ taskSplit: false });
  });
});
