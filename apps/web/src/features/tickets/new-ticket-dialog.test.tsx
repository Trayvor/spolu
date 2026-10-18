import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { i18n } from '@/i18n';
import type { FileInfo } from '@spolu/shared';
import { uploadFile } from '@/features/files/upload';
import { NewTicketDialog } from './new-ticket-dialog';
import { ADMIN, CLIENT, mockTicketApi, reply, ticket } from './test-api';

vi.mock('@/features/files/upload', () => ({ uploadFile: vi.fn() }));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

function renderDialog(props: { admin: boolean; groupId?: string }) {
  const onCreated = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NewTicketDialog {...props} onClose={vi.fn()} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return onCreated;
}

const created = (url: URL, init?: RequestInit) =>
  url.pathname === '/api/tickets' && init?.method === 'POST' ? reply(201, ticket()) : undefined;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('new ticket dialog', () => {
  it('admin dialog requires a client and shows the initiator hint', async () => {
    const { fetchMock } = mockTicketApi(ADMIN, [created]);
    const onCreated = renderDialog({ admin: true });
    expect(screen.getByText(t('tickets.form.initiatorHint'))).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(t('tickets.fields.subject')), 'Login fails');
    await userEvent.click(screen.getByRole('button', { name: t('tickets.form.create') }));
    expect(await screen.findByText(t('tickets.form.errors.client'))).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    const client = screen.getByLabelText(t('tickets.fields.client'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'ABC s.r.o.' })).toBeVisible());
    await userEvent.selectOptions(client, 'g1');
    await userEvent.type(screen.getByLabelText(t('tickets.form.email')), 'jana@x.sk');
    await userEvent.type(screen.getByLabelText(t('tickets.form.name')), 'Jana');
    await userEvent.click(screen.getByRole('button', { name: t('tickets.form.create') }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      groupId: 'g1',
      requesterEmail: 'jana@x.sk',
      requesterName: 'Jana',
      subject: 'Login fails',
      fileIds: [],
    });
  });

  it('client dialog has no client or initiator fields', async () => {
    const { fetchMock } = mockTicketApi(CLIENT, [created]);
    const onCreated = renderDialog({ admin: false, groupId: 'g1' });
    expect(screen.queryByLabelText(t('tickets.fields.client'))).toBeNull();
    expect(screen.queryByLabelText(t('tickets.form.email'))).toBeNull();
    expect(screen.queryByText(t('tickets.form.initiatorHint'))).toBeNull();
    await userEvent.type(screen.getByLabelText(t('tickets.fields.body')), 'It fails');
    await userEvent.click(screen.getByRole('button', { name: t('tickets.form.create') }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      groupId: 'g1',
      requesterEmail: null,
      body: 'It fails',
    });
  });

  it('a client puts the new ticket on a project and an event (Phase 33 part P2)', async () => {
    const { fetchMock } = mockTicketApi(CLIENT, [
      created,
      (url) =>
        url.pathname === '/api/groups/g1/projects/picker'
          ? reply(200, [{ id: 'p1', name: 'Kultúra 2026', color: 'blue', status: 'active' }])
          : undefined,
      (url) =>
        url.pathname === '/api/projects/p1/events/picker'
          ? reply(200, [{ id: 'e1', name: 'Kickoff', occursOn: '2099-11-04', source: 'manual' }])
          : undefined,
    ]);
    const onCreated = renderDialog({ admin: false, groupId: 'g1' });
    await userEvent.type(screen.getByLabelText(t('tickets.fields.body')), 'It fails');
    const project = screen.getByLabelText(t('tickets.fields.project'));
    await userEvent.click(project);
    await screen.findByRole('option', { name: 'Kultúra 2026' });
    await userEvent.selectOptions(project, 'p1');
    const event = screen.getByLabelText(t('tickets.fields.event'));
    await userEvent.click(event);
    await screen.findByRole('option', { name: /Kickoff/ });
    await userEvent.selectOptions(event, 'e1');
    await userEvent.click(screen.getByRole('button', { name: t('tickets.form.create') }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ projectId: 'p1', eventId: 'e1' });
  });

  it('a ticket needs a subject, a text or an area', async () => {
    mockTicketApi(CLIENT, [created]);
    renderDialog({ admin: false, groupId: 'g1' });
    await userEvent.click(screen.getByRole('button', { name: t('tickets.form.create') }));
    expect(await screen.findByText(t('tickets.form.errors.content'))).toBeInTheDocument();
  });

  it('Create waits for an upload: disabled with a reason, and Enter does not submit', async () => {
    let finish!: (file: FileInfo) => void;
    vi.mocked(uploadFile).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { fetchMock } = mockTicketApi(CLIENT, [created]);
    const onCreated = renderDialog({ admin: false, groupId: 'g1' });
    await userEvent.type(screen.getByLabelText(t('tickets.fields.body')), 'It fails');
    await userEvent.upload(screen.getByTestId('ticket-file-input'), new File(['x'], 'a.pdf'));

    const create = screen.getByRole('button', { name: t('tickets.form.create') });
    await waitFor(() => expect(create).toBeDisabled());
    expect(create).toHaveAccessibleDescription(t('forms.files.waiting'));
    await userEvent.type(screen.getByLabelText(t('tickets.fields.subject')), 'Hi{Enter}');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    await act(async () =>
      finish({
        id: 'f1',
        name: 'a.pdf',
        mime: 'application/pdf',
        size: 1,
        width: null,
        height: null,
        hasPreview: false,
      }),
    );
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });
});
