import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { i18n } from '@/i18n';
import { NewTicketDialog } from './new-ticket-dialog';
import { ADMIN, CLIENT, mockTicketApi, reply, ticket } from './test-api';

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

  it('a ticket needs a subject, a text or an area', async () => {
    mockTicketApi(CLIENT, [created]);
    renderDialog({ admin: false, groupId: 'g1' });
    await userEvent.click(screen.getByRole('button', { name: t('tickets.form.create') }));
    expect(await screen.findByText(t('tickets.form.errors.content'))).toBeInTheDocument();
  });
});
