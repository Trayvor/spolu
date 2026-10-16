import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormattedTextField } from './formatted-text-field';

afterEach(() => vi.unstubAllGlobals());

describe('FormattedTextField', () => {
  it('names mentions from the given people without fetching the group people', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FormattedTextField
          id="body"
          groupId="g1"
          value="Ask <@u1>"
          onChange={() => undefined}
          label="Body"
          editLabel="Edit body"
          people={[{ id: 'u1', name: 'Anna', isAdmin: false }]}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText('@Anna')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit body' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
