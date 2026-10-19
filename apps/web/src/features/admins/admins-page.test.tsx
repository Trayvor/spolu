import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { i18n, setLanguage } from '@/i18n';
import { createAppRouter } from '@/router';

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: false }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const ME = {
  id: 'a1',
  name: 'Jana Nováková',
  email: 'jana@example.com',
  role: 'admin',
  finance: false,
  groups: [],
};
const SUPER = {
  id: 's1',
  name: 'Boss',
  email: 'boss@example.com',
  role: 'superadmin',
  finance: false,
  groups: [],
};
const PETER = {
  id: 'a2',
  name: 'Peter Horváth',
  email: 'peter@example.com',
  role: 'admin',
  finance: false,
  groups: [],
};

type Reply = { status: number; body?: unknown };

/** Fake `fetch` for /me and /admins; `post` and `del` answer the write calls. */
function mockApi(
  options: { me?: typeof ME | (typeof ME & { role: string }); post?: Reply; del?: Reply } = {},
) {
  const me = options.me ?? ME;
  const list = [SUPER, ME, PETER];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const reply = (r: Reply) =>
      new Response(r.body === undefined ? null : JSON.stringify(r.body), r);
    if (url === '/api/me') return reply({ status: 200, body: me });
    if (url === '/api/admins' && method === 'GET') return reply({ status: 200, body: list });
    if (url === '/api/admins' && method === 'POST') {
      return reply(
        options.post ?? {
          status: 201,
          body: { id: 'a3', name: 'Eva', email: 'eva@example.com', role: 'admin' },
        },
      );
    }
    if (url.startsWith('/api/admins/') && method === 'DELETE') {
      return reply(options.del ?? { status: 204 });
    }
    return reply({ status: 404, body: {} });
  });
  vi.stubGlobal('fetch', fetchMock);
  const calls = (method: string, url: string) =>
    fetchMock.mock.calls.filter(
      ([u, init]) => u === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
    );
  return { calls };
}

function renderAdmins() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ['/admins'] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('admins page', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('lists admins with Superadmin and You badges', async () => {
    mockApi();
    renderAdmins();
    await screen.findByText('Peter Horváth');
    expect(within(rowOf('Boss')).getByText(t('admins.badge.superadmin'))).toBeInTheDocument();
    expect(within(rowOf('Jana Nováková')).getByText(t('admins.badge.you'))).toBeInTheDocument();
    expect(within(rowOf('Peter Horváth')).queryByText(t('admins.badge.you'))).toBeNull();
    expect(screen.getByText('peter@example.com')).toBeInTheDocument();
  });

  it('links to the audit log', async () => {
    mockApi();
    renderAdmins();
    const link = await screen.findByRole('link', { name: t('admins.auditLink') });
    expect(link).toHaveAttribute('href', '/audit');
  });

  it('no Remove button on the superadmin or on yourself', async () => {
    mockApi();
    renderAdmins();
    await screen.findByText('Peter Horváth');
    const remove = t('admins.remove');
    expect(within(rowOf('Boss')).queryByRole('button', { name: remove })).toBeNull();
    expect(within(rowOf('Jana Nováková')).queryByRole('button', { name: remove })).toBeNull();
    expect(
      within(rowOf('Peter Horváth')).getByRole('button', { name: remove }),
    ).toBeInTheDocument();
  });

  it('add form validates name and email before sending', async () => {
    const { calls } = mockApi();
    const user = renderAdmins();
    await user.click(await screen.findByRole('button', { name: t('admins.add') }));
    await user.click(screen.getByRole('button', { name: t('admins.submit') }));
    expect(await screen.findByText(t('admins.errors.nameRequired'))).toBeInTheDocument();

    await user.type(screen.getByLabelText(t('admins.name')), 'Eva');
    await user.type(screen.getByLabelText(t('admins.email')), 'not-an-email');
    await user.click(screen.getByRole('button', { name: t('admins.submit') }));
    expect(await screen.findByText(t('login.errors.invalidEmail'))).toBeInTheDocument();
    expect(calls('POST', '/api/admins')).toHaveLength(0);
  });

  it('successful add shows "{name} was added." and refreshes the list', async () => {
    const { calls } = mockApi();
    const user = renderAdmins();
    await user.click(await screen.findByRole('button', { name: t('admins.add') }));
    await user.type(screen.getByLabelText(t('admins.name')), ' Eva ');
    await user.type(screen.getByLabelText(t('admins.email')), ' Eva@Example.com ');
    await user.click(screen.getByRole('button', { name: t('admins.submit') }));

    expect(await screen.findByText(t('admins.added', { name: 'Eva' }))).toBeInTheDocument();
    const [, init] = calls('POST', '/api/admins')[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Eva', email: 'eva@example.com' });
    await waitFor(() => expect(calls('GET', '/api/admins')).toHaveLength(2));
    expect(screen.queryByLabelText(t('admins.name'))).toBeNull();
  });

  it.each([
    ['email_taken_admin', 'admins.errors.emailTakenAdmin'],
    ['email_taken_client', 'admins.errors.emailTakenClient'],
  ])('409 %s shows its message', async (code, key) => {
    mockApi({ post: { status: 409, body: { error: code } } });
    const user = renderAdmins();
    await user.click(await screen.findByRole('button', { name: t('admins.add') }));
    await user.type(screen.getByLabelText(t('admins.name')), 'Eva');
    await user.type(screen.getByLabelText(t('admins.email')), 'eva@example.com');
    await user.click(screen.getByRole('button', { name: t('admins.submit') }));
    expect(await screen.findByText(t(key))).toBeInTheDocument();
  });

  it('Remove asks inline, Cancel restores the row, confirming calls DELETE and refreshes', async () => {
    const { calls } = mockApi();
    const user = renderAdmins();
    await screen.findByText('Peter Horváth');

    await user.click(
      within(rowOf('Peter Horváth')).getByRole('button', { name: t('admins.remove') }),
    );
    expect(
      screen.getByText(t('admins.confirmRemove', { name: 'Peter Horváth' })),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('admins.cancel') }));
    expect(screen.queryByText(t('admins.confirmRemove', { name: 'Peter Horváth' }))).toBeNull();
    expect(screen.getByText('peter@example.com')).toBeInTheDocument();

    await user.click(
      within(rowOf('Peter Horváth')).getByRole('button', { name: t('admins.remove') }),
    );
    await user.click(screen.getByRole('button', { name: t('admins.remove') }));
    await waitFor(() => expect(calls('DELETE', '/api/admins/a2')).toHaveLength(1));
    await waitFor(() => expect(calls('GET', '/api/admins')).toHaveLength(2));
  });

  it('moves focus to the confirmation and back to Remove on Cancel', async () => {
    mockApi();
    const user = renderAdmins();
    await screen.findByText('Peter Horváth');
    await user.click(
      within(rowOf('Peter Horváth')).getByRole('button', { name: t('admins.remove') }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t('admins.remove') })).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: t('admins.cancel') }));
    await waitFor(() =>
      expect(
        within(rowOf('Peter Horváth')).getByRole('button', { name: t('admins.remove') }),
      ).toHaveFocus(),
    );
  });

  it('focuses the first invalid field and announces the status in a live region', async () => {
    mockApi();
    const user = renderAdmins();
    await user.click(await screen.findByRole('button', { name: t('admins.add') }));
    await user.click(screen.getByRole('button', { name: t('admins.submit') }));
    expect(screen.getByLabelText(t('admins.name'))).toHaveFocus();

    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    await user.type(screen.getByLabelText(t('admins.name')), 'Eva');
    await user.type(screen.getByLabelText(t('admins.email')), 'eva@example.com');
    await user.click(screen.getByRole('button', { name: t('admins.submit') }));
    await waitFor(() => expect(status).toHaveTextContent(t('admins.added', { name: 'Eva' })));
    await user.click(screen.getByRole('button', { name: t('admins.add') }));
    expect(status).toBeEmptyDOMElement();
  });

  it('a client visiting /admins sees the not-found page', async () => {
    mockApi({ me: { ...ME, role: 'client' } });
    renderAdmins();
    expect(await screen.findByText(t('notFound.title'))).toBeInTheDocument();
    expect(screen.queryByText(t('admins.title'))).toBeNull();
  });
});

describe('the Finance switch (Phase 32)', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  /** The superadmin's view: the list carries `finance`, the switch writes it. */
  function mockSuperadmin(fail = false) {
    const finance: Record<string, boolean> = { s1: true, a1: false, a2: true };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const json = (status: number, body?: unknown) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status });
      if (url === '/api/me') return json(200, { ...SUPER, finance: true });
      if (url === '/api/admins' && method === 'GET') {
        return json(
          200,
          [SUPER, ME, PETER].map((a) => ({ ...a, groups: undefined, finance: finance[a.id] })),
        );
      }
      const match = /^\/api\/admins\/(\w+)\/finance-access$/.exec(url);
      if (match && (method === 'PUT' || method === 'DELETE')) {
        if (fail) return json(500, { error: 'server_error' });
        finance[match[1]!] = method === 'PUT';
        return json(204);
      }
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    return {
      calls: (method: string, url: string) =>
        fetchMock.mock.calls.filter(
          ([u, init]) =>
            u === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
        ),
    };
  }

  it('the superadmin sees a switch on each admin, none on their own row', async () => {
    mockSuperadmin();
    renderAdmins();
    await screen.findByText('Peter Horváth');
    const peter = within(rowOf('Peter Horváth')).getByRole('switch');
    expect(peter).toHaveAccessibleName(t('admins.finance.labelFor', { name: 'Peter Horváth' }));
    expect(peter).toHaveAttribute('aria-checked', 'true');
    expect(within(rowOf('Jana Nováková')).getByRole('switch')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(within(rowOf('Boss')).queryByRole('switch')).toBeNull();
  });

  it('turning it on and off grants and removes the right', async () => {
    const { calls } = mockSuperadmin();
    const user = renderAdmins();
    await screen.findByText('Peter Horváth');
    const jana = within(rowOf('Jana Nováková')).getByRole('switch');
    await user.click(jana);
    await waitFor(() => expect(calls('PUT', '/api/admins/a1/finance-access')).toHaveLength(1));
    await waitFor(() => expect(jana).toHaveAttribute('aria-checked', 'true'));
    await user.click(within(rowOf('Peter Horváth')).getByRole('switch'));
    await waitFor(() => expect(calls('DELETE', '/api/admins/a2/finance-access')).toHaveLength(1));
  });

  it('a change offers Undo, which switches it back', async () => {
    const { calls } = mockSuperadmin();
    const user = renderAdmins();
    await screen.findByText('Peter Horváth');
    const peter = within(rowOf('Peter Horváth')).getByRole('switch');
    await user.click(peter);
    expect(
      await screen.findByText(t('admins.finance.revoked', { name: 'Peter Horváth' })),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('admins.undo') }));
    await waitFor(() => expect(calls('PUT', '/api/admins/a2/finance-access')).toHaveLength(1));
    await waitFor(() => expect(peter).toHaveAttribute('aria-checked', 'true'));
    // The undo itself is not offered for undo again.
    expect(screen.queryByRole('button', { name: t('admins.undo') })).toBeNull();
  });

  it('a failed change says so and the switch goes back', async () => {
    mockSuperadmin(true);
    const user = renderAdmins();
    await screen.findByText('Peter Horváth');
    const jana = within(rowOf('Jana Nováková')).getByRole('switch');
    await user.click(jana);
    expect(await screen.findByRole('alert')).toHaveTextContent(t('admins.finance.failed'));
    expect(jana).toHaveAttribute('aria-checked', 'false');
  });

  it('another admin sees no switch at all', async () => {
    mockApi();
    renderAdmins();
    await screen.findByText('Peter Horváth');
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('admins page: substitution (2026-10-19)', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  /** The list with server-side substitutions; PUT and DELETE change them (or fail with `putError`). */
  function mockSubstitutions(options: { putError?: { status: number; error: string } } = {}) {
    const people = [SUPER, ME, PETER];
    const subs = new Map<string, { substituteId: string; endsOn: string | null }>();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const json = (status: number, body?: unknown) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status });
      if (url === '/api/me') return json(200, ME);
      if (url === '/api/admins' && method === 'GET') {
        return json(
          200,
          people.map((a) => {
            const s = subs.get(a.id);
            const substitute = s && people.find((p) => p.id === s.substituteId)!;
            return {
              ...a,
              groups: undefined,
              substitution: s
                ? {
                    id: `s-${a.id}`,
                    substitutedId: a.id,
                    substituteId: s.substituteId,
                    substituteName: substitute!.name,
                    endsOn: s.endsOn,
                  }
                : null,
            };
          }),
        );
      }
      const match = /^\/api\/admins\/(\w+)\/substitution$/.exec(url);
      if (match && method === 'PUT') {
        if (options.putError)
          return json(options.putError.status, { error: options.putError.error });
        const body = JSON.parse(String(init?.body)) as {
          substituteId: string;
          endsOn: string | null;
        };
        subs.set(match[1]!, body);
        const substitute = people.find((p) => p.id === body.substituteId)!;
        return json(201, {
          id: `s-${match[1]}`,
          substitutedId: match[1],
          substituteId: body.substituteId,
          substituteName: substitute.name,
          endsOn: body.endsOn,
        });
      }
      if (match && method === 'DELETE') {
        subs.delete(match[1]!);
        return json(204);
      }
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    return {
      subs,
      calls: (method: string, url: string) =>
        fetchMock.mock.calls.filter(
          ([u, init]) =>
            u === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
        ),
    };
  }

  it('every row offers Substitute, also your own', async () => {
    mockSubstitutions();
    renderAdmins();
    await screen.findByText('Peter Horváth');
    for (const name of ['Boss', 'Jana Nováková', 'Peter Horváth']) {
      expect(
        within(rowOf(name)).getByRole('button', {
          name: t('admins.substitution.actionFor', { name }),
        }),
      ).toBeInTheDocument();
    }
  });

  it('the dialog lists the other admins, requires a pick and sends the substitute and the date', async () => {
    const { calls } = mockSubstitutions();
    const user = renderAdmins();
    await screen.findByText('Peter Horváth');
    await user.click(
      within(rowOf('Peter Horváth')).getByRole('button', {
        name: t('admins.substitution.actionFor', { name: 'Peter Horváth' }),
      }),
    );
    const dialog = await screen.findByTestId('substitution-dialog');
    const select = within(dialog).getByLabelText(t('admins.substitution.substitute'));
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([t('admins.substitution.pick'), 'Boss', 'Jana Nováková']);
    // Nothing picked: no request.
    await user.click(within(dialog).getByRole('button', { name: t('admins.substitution.save') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      t('admins.substitution.errors.pick'),
    );
    expect(calls('PUT', '/api/admins/a2/substitution')).toHaveLength(0);

    await user.selectOptions(select, 'a1');
    const date = within(dialog).getByLabelText(t('admins.substitution.endsOn'));
    await user.type(date, '2031-01-31');
    await user.click(within(dialog).getByRole('button', { name: t('admins.substitution.save') }));
    await waitFor(() => expect(calls('PUT', '/api/admins/a2/substitution')).toHaveLength(1));
    const [, init] = calls('PUT', '/api/admins/a2/substitution')[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({ substituteId: 'a1', endsOn: '2031-01-31' });
    await waitFor(() => expect(screen.queryByTestId('substitution-dialog')).toBeNull());
    expect(
      await within(rowOf('Peter Horváth')).findByText(
        t('admins.substitution.badgeUntil', { name: 'Jana Nováková', date: '1/31' }),
      ),
    ).toBeInTheDocument();
  });

  it('an open-ended substitution shows the badge without a date, and End removes it', async () => {
    const { subs, calls } = mockSubstitutions();
    subs.set('a2', { substituteId: 'a1', endsOn: null });
    const user = renderAdmins();
    await screen.findByText('Peter Horváth');
    const row = rowOf('Peter Horváth');
    expect(
      within(row).getByText(t('admins.substitution.badge', { name: 'Jana Nováková' })),
    ).toBeInTheDocument();
    expect(
      within(row).queryByRole('button', {
        name: t('admins.substitution.actionFor', { name: 'Peter Horváth' }),
      }),
    ).toBeNull();
    await user.click(
      within(row).getByRole('button', {
        name: t('admins.substitution.endFor', { name: 'Peter Horváth' }),
      }),
    );
    await waitFor(() => expect(calls('DELETE', '/api/admins/a2/substitution')).toHaveLength(1));
    expect(
      await screen.findByText(t('admins.substitution.ended', { name: 'Peter Horváth' })),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(rowOf('Peter Horváth')).queryByText(
          t('admins.substitution.badge', { name: 'Jana Nováková' }),
        ),
      ).toBeNull(),
    );
  });

  it('a substituted admin is not offered as a substitute (no chains)', async () => {
    const { subs } = mockSubstitutions();
    subs.set('s1', { substituteId: 'a2', endsOn: null });
    const user = renderAdmins();
    await screen.findByText('Peter Horváth');
    await user.click(
      within(rowOf('Jana Nováková')).getByRole('button', {
        name: t('admins.substitution.actionFor', { name: 'Jana Nováková' }),
      }),
    );
    const dialog = await screen.findByTestId('substitution-dialog');
    const select = within(dialog).getByLabelText(t('admins.substitution.substitute'));
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([t('admins.substitution.pick'), 'Peter Horváth']);
  });

  it("shows the server's reason when it refuses", async () => {
    mockSubstitutions({ putError: { status: 409, error: 'substitute_away' } });
    const user = renderAdmins();
    await screen.findByText('Peter Horváth');
    await user.click(
      within(rowOf('Peter Horváth')).getByRole('button', {
        name: t('admins.substitution.actionFor', { name: 'Peter Horváth' }),
      }),
    );
    const dialog = await screen.findByTestId('substitution-dialog');
    await user.selectOptions(
      within(dialog).getByLabelText(t('admins.substitution.substitute')),
      'a1',
    );
    await user.click(within(dialog).getByRole('button', { name: t('admins.substitution.save') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      t('admins.substitution.errors.away'),
    );
  });
});
