import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UnseenMark } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { UnseenMarker } from './marker';

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

let calls: string[] = [];
beforeEach(async () => {
  await setLanguage('en');
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/tasks/t1/unseen-summary') {
        return new Response(
          JSON.stringify({
            lines: [{ kind: 'messages', count: 1, authors: ['Jana'] }, { kind: 'assigned' }],
            more: 0,
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderMarker(mark: UnseenMark | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UnseenMarker mark={mark} target={{ kind: 'task', id: 't1' }} />
    </QueryClientProvider>,
  );
}

describe('UnseenMarker (2026-10-18)', () => {
  it('a change: a plain yellow dot named "New change"', () => {
    renderMarker('change');
    const button = screen.getByRole('button', { name: t('unseen.mark.change') });
    expect(button.querySelector('[data-testid="unseen-dot"]')).toHaveClass('bg-attention');
    expect(button.querySelector('[data-testid="unseen-ring"]')).toBeNull();
  });

  it('a message: a yellow ring with a dot inside, named "New message"', () => {
    renderMarker('message');
    const button = screen.getByRole('button', { name: t('unseen.mark.message') });
    const ring = button.querySelector('[data-testid="unseen-ring"]');
    expect(ring).toHaveClass('border-attention');
    expect(ring?.firstElementChild).toHaveClass('bg-attention');
    expect(button.querySelector('[data-testid="unseen-dot"]')).toBeNull();
  });

  it('nothing without an unseen change, and nothing is fetched', () => {
    const { container } = renderMarker(null);
    expect(container).toBeEmptyDOMElement();
    expect(calls).toEqual([]);
  });

  it('fetches what changed only on hover, and shows it as the description', async () => {
    renderMarker('message');
    const button = screen.getByRole('button', { name: t('unseen.mark.message') });
    expect(calls).toEqual([]);
    await userEvent.hover(button);
    const tooltip = await screen.findByRole('tooltip');
    expect(await screen.findAllByText(t('unseen.lines.assigned'))).not.toHaveLength(0);
    expect(tooltip).toHaveTextContent(t('unseen.lines.messages', { count: 1, authors: 'Jana' }));
    expect(button).toHaveAttribute('aria-describedby', tooltip.id);
    expect(calls).toEqual(['/api/tasks/t1/unseen-summary']);
  });

  it('keyboard focus opens it too; Escape closes it', async () => {
    renderMarker('change');
    await userEvent.tab();
    const button = screen.getByRole('button', { name: t('unseen.mark.change') });
    expect(button).toHaveFocus();
    expect(button.className).toContain('focus-visible:outline-2');
    expect(await screen.findByRole('tooltip')).toHaveTextContent(t('unseen.lines.assigned'));
    expect(calls).toEqual(['/api/tasks/t1/unseen-summary']);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('a tap toggles it (touch has no hover)', async () => {
    renderMarker('change');
    const button = screen.getByRole('button', { name: t('unseen.mark.change') });
    await userEvent.click(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(t('unseen.lines.assigned'));
  });
});
