import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Group } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { GroupForm } from './group-form';
import { resizeImage } from '@/lib/resize-image';

vi.mock('@/lib/resize-image', () => ({ resizeImage: vi.fn() }));

const t = (key: string) => i18n.t(key);

const SAVED: Group = {
  id: 'g1',
  name: 'Acme',
  egrantUrl: 'https://acme.egrant.sk',
  hasLogo: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
  inviteUrl: 'https://spolu.test/join/tok',
};

type Reply = { status: number; body?: unknown };

function mockApi(replies: Record<string, Reply> = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const r = replies[key] ?? defaults[key] ?? { status: 404, body: {} };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  });
  const defaults: Record<string, Reply> = {
    'POST /api/groups': { status: 201, body: SAVED },
    'PATCH /api/groups/g1': { status: 200, body: SAVED },
    'PUT /api/groups/g1/logo': { status: 204 },
    'DELETE /api/groups/g1/logo': { status: 204 },
  };
  vi.stubGlobal('fetch', fetchMock);
  const calls = (key: string) =>
    fetchMock.mock.calls.filter(
      ([u, i]) => `${(i as RequestInit | undefined)?.method ?? 'GET'} ${u}` === key,
    );
  return { calls };
}

function renderForm(group?: Group) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <GroupForm group={group} onSaved={onSaved} onCancel={onCancel} />
    </QueryClientProvider>,
  );
  return { onSaved, onCancel, user: userEvent.setup() };
}

describe('GroupForm', () => {
  beforeEach(async () => {
    await setLanguage('en');
    vi.mocked(resizeImage).mockReset();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('create form validates the name and the URL', async () => {
    const { calls } = mockApi();
    const { user, onSaved } = renderForm();
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    expect(await screen.findByText(t('groups.errors.nameRequired'))).toBeInTheDocument();

    await user.type(screen.getByLabelText(t('groups.form.name')), 'Acme');
    await user.type(screen.getByLabelText(t('groups.form.egrantUrl')), 'not a url');
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    expect(await screen.findByText(t('groups.errors.invalidUrl'))).toBeInTheDocument();
    expect(calls('POST /api/groups')).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows urlTaken on a 409', async () => {
    mockApi({ 'POST /api/groups': { status: 409, body: { error: 'egrant_url_taken' } } });
    const { user, onSaved } = renderForm();
    await user.type(screen.getByLabelText(t('groups.form.name')), 'Acme');
    await user.type(screen.getByLabelText(t('groups.form.egrantUrl')), 'https://acme.egrant.sk');
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    expect(await screen.findByText(t('groups.errors.urlTaken'))).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('create without a logo posts the trimmed input and reports the group', async () => {
    const { calls } = mockApi();
    const { user, onSaved } = renderForm();
    await user.type(screen.getByLabelText(t('groups.form.name')), '  Acme ');
    await user.type(screen.getByLabelText(t('groups.form.egrantUrl')), 'https://acme.egrant.sk');
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED));
    const body = JSON.parse((calls('POST /api/groups')[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ name: 'Acme', egrantUrl: 'https://acme.egrant.sk' });
    expect(calls('PUT /api/groups/g1/logo')).toHaveLength(0);
  });

  it('create with a logo resizes then uploads', async () => {
    const resized = new Blob(['small'], { type: 'image/webp' });
    vi.mocked(resizeImage).mockResolvedValue(resized);
    const { calls } = mockApi();
    const { user, onSaved } = renderForm();
    await user.type(screen.getByLabelText(t('groups.form.name')), 'Acme');
    await user.type(screen.getByLabelText(t('groups.form.egrantUrl')), 'https://acme.egrant.sk');
    const file = new File(['big'], 'logo.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(t('groups.form.logo')), file);
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(resizeImage).toHaveBeenCalledWith(file);
    const put = calls('PUT /api/groups/g1/logo')[0]?.[1] as RequestInit;
    expect(put.body).toBe(resized);
    expect((put.headers as Record<string, string>)['Content-Type']).toBe('image/webp');
  });

  it('a failed logo upload keeps the created group and shows invalidLogo', async () => {
    vi.mocked(resizeImage).mockResolvedValue(new Blob(['small'], { type: 'image/webp' }));
    const { calls } = mockApi({
      'PUT /api/groups/g1/logo': { status: 400, body: { error: 'invalid_logo' } },
    });
    const { user, onSaved } = renderForm();
    await user.type(screen.getByLabelText(t('groups.form.name')), 'Acme');
    await user.type(screen.getByLabelText(t('groups.form.egrantUrl')), 'https://acme.egrant.sk');
    await user.upload(
      screen.getByLabelText(t('groups.form.logo')),
      new File(['b'], 'l.png', { type: 'image/png' }),
    );
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));

    expect(await screen.findByText(t('groups.errors.invalidLogo'))).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    // The group exists now: saving again edits it instead of creating a second one.
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    await waitFor(() => expect(calls('PATCH /api/groups/g1')).toHaveLength(1));
    expect(calls('POST /api/groups')).toHaveLength(1);
  });

  it('a 500 on the logo upload shows the generic error, not invalidLogo', async () => {
    vi.mocked(resizeImage).mockResolvedValue(new Blob(['small'], { type: 'image/webp' }));
    mockApi({ 'PUT /api/groups/g1/logo': { status: 500, body: { error: 'server_error' } } });
    const { user } = renderForm();
    await user.type(screen.getByLabelText(t('groups.form.name')), 'Acme');
    await user.type(screen.getByLabelText(t('groups.form.egrantUrl')), 'https://acme.egrant.sk');
    await user.upload(
      screen.getByLabelText(t('groups.form.logo')),
      new File(['b'], 'l.png', { type: 'image/png' }),
    );
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument();
    expect(screen.queryByText(t('groups.errors.invalidLogo'))).toBeNull();
  });

  it('a validation_failed answer shows the generic error and the name is capped at 100', async () => {
    mockApi({ 'POST /api/groups': { status: 400, body: { error: 'validation_failed' } } });
    const { user } = renderForm();
    expect(screen.getByLabelText(t('groups.form.name'))).toHaveAttribute('maxlength', '100');
    await user.type(screen.getByLabelText(t('groups.form.name')), 'Acme');
    await user.type(screen.getByLabelText(t('groups.form.egrantUrl')), 'https://acme.egrant.sk');
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument();
    expect(screen.queryByText(t('groups.errors.invalidUrl'))).toBeNull();
  });

  it('a logo that cannot be resized shows invalidLogo', async () => {
    vi.mocked(resizeImage).mockRejectedValue(new Error('bad'));
    mockApi();
    const { user } = renderForm();
    await user.type(screen.getByLabelText(t('groups.form.name')), 'Acme');
    await user.type(screen.getByLabelText(t('groups.form.egrantUrl')), 'https://acme.egrant.sk');
    await user.upload(
      screen.getByLabelText(t('groups.form.logo')),
      new File(['b'], 'l.pdf', { type: 'image/png' }),
    );
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    expect(await screen.findByText(t('groups.errors.invalidLogo'))).toBeInTheDocument();
  });

  it('edit form is prefilled and patches the group', async () => {
    const { calls } = mockApi();
    const { user, onSaved } = renderForm(SAVED);
    expect(screen.getByLabelText(t('groups.form.name'))).toHaveValue('Acme');
    expect(screen.getByLabelText(t('groups.form.egrantUrl'))).toHaveValue('https://acme.egrant.sk');
    expect(
      screen.queryByRole('button', { name: t('groups.form.removeLogo') }),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText(t('groups.form.name')));
    await user.type(screen.getByLabelText(t('groups.form.name')), 'Acme 2');
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse((calls('PATCH /api/groups/g1')[0]?.[1] as RequestInit).body as string);
    expect(body.name).toBe('Acme 2');
  });

  it('remove logo deletes the logo on save', async () => {
    const { calls } = mockApi({
      'PATCH /api/groups/g1': { status: 200, body: { ...SAVED, hasLogo: true } },
    });
    const { user, onSaved } = renderForm({ ...SAVED, hasLogo: true });
    await user.click(screen.getByRole('button', { name: t('groups.form.removeLogo') }));
    expect(
      screen.queryByRole('button', { name: t('groups.form.removeLogo') }),
    ).not.toBeInTheDocument();
    expect(calls('DELETE /api/groups/g1/logo')).toHaveLength(0); // nothing until Save
    await user.click(screen.getByRole('button', { name: t('groups.form.save') }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls('DELETE /api/groups/g1/logo')).toHaveLength(1);
  });

  it('Cancel calls onCancel without saving', async () => {
    const { calls } = mockApi();
    const { user, onCancel } = renderForm();
    await user.click(screen.getByRole('button', { name: t('groups.form.cancel') }));
    expect(onCancel).toHaveBeenCalled();
    expect(calls('POST /api/groups')).toHaveLength(0);
  });
});
