import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SidebarClient } from '@spolu/shared';
import { i18n } from '@/i18n';
import { ClientSidebarList } from './client-sidebar';
import { renderWithRouter } from './test-router';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const client = (over: Partial<SidebarClient> & { groupId: string; name: string }) =>
  ({
    hasLogo: false,
    updatedAt: '2026-10-15T10:00:00.000Z',
    managed: false,
    unread: 0,
    assigned: 0,
    ...over,
  }) as SidebarClient;

const CLIENTS = [
  client({ groupId: 'g1', name: 'ABC s.r.o.', managed: true, unread: 4, assigned: 2 }),
  client({ groupId: 'g2', name: 'Obec Dolany', managed: true, unread: 1 }),
  client({ groupId: 'g3', name: 'Obec Lúky', unread: 12 }),
  client({ groupId: 'g4', name: 'Firma XY' }),
];

describe('ClientSidebarList', () => {
  it('two sections in server order', async () => {
    await renderWithRouter(() => <ClientSidebarList clients={CLIENTS} rowHeight={40} />);
    const managed = screen.getByRole('heading', { name: t('adminHome.sidebar.managed') });
    const others = screen.getByRole('heading', { name: t('adminHome.sidebar.others') });
    const names = (heading: HTMLElement) =>
      within(heading.closest('section')!)
        .getAllByRole('link')
        .map((link) => link.textContent);
    // A link's text starts with the logo's letter tile.
    const [abc, dolany] = names(managed);
    expect([abc?.includes('ABC s.r.o.'), dolany?.includes('Obec Dolany')]).toEqual([true, true]);
    const [luky, xy] = names(others);
    expect([luky?.includes('Obec Lúky'), xy?.includes('Firma XY')]).toEqual([true, true]);
  });

  it('one unlabelled list when nothing is managed', async () => {
    await renderWithRouter(() => (
      <ClientSidebarList clients={CLIENTS.map((c) => ({ ...c, managed: false }))} rowHeight={40} />
    ));
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('search filters both sections and ignores accents', async () => {
    await renderWithRouter(() => <ClientSidebarList clients={CLIENTS} rowHeight={40} />);
    await userEvent.type(screen.getByLabelText(t('adminHome.sidebar.find')), 'luky');
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('Obec Lúky');
    expect(screen.queryByRole('heading', { name: t('adminHome.sidebar.managed') })).toBeNull();
    await userEvent.type(screen.getByLabelText(t('adminHome.sidebar.find')), 'zzz');
    expect(screen.getByText(t('adminHome.sidebar.noMatch'))).toBeInTheDocument();
  });

  it('black and yellow pills, hidden at 0', async () => {
    await renderWithRouter(() => <ClientSidebarList clients={CLIENTS} rowHeight={40} />);
    const abc = screen.getByRole('link', { name: /ABC/ });
    expect(within(abc).getByText(t('adminHome.sidebar.unread', { count: 4 }))).toBeInTheDocument();
    expect(
      within(abc).getByText(t('adminHome.sidebar.assigned', { count: 2 })),
    ).toBeInTheDocument();
    expect(within(abc).getByText('2').parentElement).toHaveClass('bg-attention');
    const xy = screen.getByRole('link', { name: /Firma XY/ });
    expect(within(xy).queryByText(/unread|assigned/)).toBeNull();
  });

  it('the current client is marked with aria-current', async () => {
    await renderWithRouter(
      () => <ClientSidebarList clients={CLIENTS} currentGroupId="g2" rowHeight={40} />,
      '/groups/g2/chat',
    );
    expect(screen.getByRole('link', { name: /Obec Dolany/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /ABC/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /ABC/ })).toHaveAttribute('href', '/groups/g1/chat');
  });

  it('collapsed shows logos with an ink dot for unread, else a yellow dot for assigned', async () => {
    const clients = [
      client({ groupId: 'g1', name: 'Unread', unread: 2, assigned: 1, managed: true }),
      client({ groupId: 'g2', name: 'Assigned', assigned: 3, managed: true }),
      client({ groupId: 'g3', name: 'Quiet' }),
    ];
    await renderWithRouter(() => <ClientSidebarList clients={clients} rowHeight={40} collapsed />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    const dotOf = (name: RegExp) =>
      within(screen.getByRole('link', { name })).queryByTestId('rail-dot');
    expect(dotOf(/^Unread/)).toHaveClass('bg-primary');
    expect(dotOf(/^Assigned/)).toHaveClass('bg-attention');
    expect(dotOf(/^Quiet/)).toBeNull();
    expect(screen.getByRole('link', { name: /^Assigned/ })).toHaveAttribute('title', 'Assigned');
  });
});
