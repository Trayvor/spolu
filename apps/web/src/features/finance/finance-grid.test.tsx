import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { i18n, setLanguage } from '@/i18n';
import { FinanceGrid } from './finance-grid';

const t = (key: string) => i18n.t(key);

/** `matchMedia` answering `(max-width: 640px)` as a phone would, or not. */
function viewport(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query === '(max-width: 640px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function renderGrid(props: Partial<Parameters<typeof FinanceGrid>[0]> = {}) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(sessionQuery.queryKey, {
    id: 'a1',
    name: 'Eva',
    email: 'eva@example.com',
    role: 'admin',
    finance: true,
    groups: [],
  } as Me);
  const ui = (
    <QueryClientProvider client={queryClient}>
      <FinanceGrid
        screen="tab"
        overview={<p>overview-card</p>}
        documents={<p>documents-card</p>}
        workLog={<p>work-log-card</p>}
        {...props}
      />
    </QueryClientProvider>
  );
  return { ...render(ui), user: userEvent.setup() };
}

describe('FinanceGrid', () => {
  beforeEach(async () => {
    await setLanguage('en');
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lays the three cards into their slots on a computer, without a segmented control', () => {
    viewport(false);
    renderGrid();
    const grid = screen.getByTestId('finance-grid');
    expect(grid).toHaveAttribute('data-layout', 'grid');
    expect(grid).toHaveClass(
      'min-[1024px]:grid-cols-[7fr_3fr]',
      'min-[1024px]:grid-rows-[auto_minmax(360px,1fr)]',
    );
    const slot = (name: string) => grid.querySelector(`[data-slot="${name}"]`) as HTMLElement;
    expect(within(slot('overview')).getByText('overview-card')).toBeInTheDocument();
    expect(within(slot('documents')).getByText('documents-card')).toBeInTheDocument();
    expect(within(slot('workLog')).getByText('work-log-card')).toBeInTheDocument();
    // The work log takes the whole right column; documents sit under the overview.
    expect(slot('workLog')).toHaveClass('min-[1024px]:row-span-2', 'min-[1024px]:col-start-2');
    expect(slot('documents')).toHaveClass('min-[1024px]:row-start-2');
    // The overview's charts are never scrolled; the other two scroll inside themselves.
    expect(slot('overview')).not.toHaveClass('min-[1024px]:min-h-0');
    expect(slot('documents')).toHaveClass('min-[1024px]:contain-size');
    expect(slot('workLog')).toHaveClass('min-[1024px]:contain-size');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('on a phone shows one card under a segmented control and mounts only that one', async () => {
    viewport(true);
    const { user } = renderGrid();
    const control = screen.getByRole('radiogroup', { name: t('finance.segments.label') });
    const options = within(control).getAllByRole('radio');
    expect(options.map((o) => o.textContent)).toEqual([
      t('finance.segments.overview'),
      t('finance.segments.documents'),
      t('finance.segments.workLog'),
    ]);
    expect(screen.getByText('overview-card')).toBeInTheDocument();
    expect(screen.queryByText('work-log-card')).toBeNull();

    await user.click(within(control).getByRole('radio', { name: t('finance.segments.workLog') }));
    expect(screen.getByText('work-log-card')).toBeInTheDocument();
    expect(screen.queryByText('overview-card')).toBeNull();

    // Arrow keys move the choice, as in a radio group.
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('documents-card')).toBeInTheDocument();
    expect(
      within(control).getByRole('radio', { name: t('finance.segments.documents') }),
    ).toHaveFocus();
  });

  it('remembers the chosen card per person and screen', async () => {
    viewport(true);
    const first = renderGrid();
    await first.user.click(screen.getByRole('radio', { name: t('finance.segments.workLog') }));
    first.unmount();
    renderGrid();
    expect(screen.getByText('work-log-card')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: t('finance.segments.workLog') })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('the system-wide page adds a Rankings segment and its row under the grid', () => {
    viewport(true);
    renderGrid({ screen: 'page', rankings: <p>rankings-row</p> });
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    viewport(false);
  });
});
