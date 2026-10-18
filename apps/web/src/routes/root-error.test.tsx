import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n, setLanguage } from '@/i18n';
import { RootError, page, resetRetryMemory } from './root-error';

const invalidate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }));

const reload = vi.spyOn(page, 'reload').mockImplementation(() => undefined);

describe('RootError', () => {
  beforeEach(async () => {
    await setLanguage('en');
    invalidate.mockReset();
    reload.mockReset();
    resetRetryMemory();
  });

  const retry = () => screen.getByRole('button', { name: i18n.t('errors.retry') });

  it('retry resets the boundary and the router without reloading the page', async () => {
    const reset = vi.fn();
    render(<RootError error={new Error('/api/me failed')} reset={reset} />);
    await userEvent.click(retry());
    expect(reset).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the page when a lazy chunk failed to load (a stale deploy)', async () => {
    const reset = vi.fn();
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/x.js');
    render(<RootError error={error} reset={reset} />);
    await userEvent.click(retry());
    expect(reload).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
  });

  it('reloads when the same error comes back after a retry', async () => {
    const reset = vi.fn();
    const { rerender } = render(<RootError error={new Error('boom')} reset={reset} />);
    await userEvent.click(retry());
    expect(reload).not.toHaveBeenCalled();
    rerender(<RootError error={new Error('boom')} reset={reset} />);
    await userEvent.click(retry());
    expect(reload).toHaveBeenCalledOnce();
  });
});
