import { screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n';
import { loadAllNamespaces } from '@/i18n/namespaces';
import { navCountsQuery } from './api';
import { renderWithRouter } from './test-router';
import { isReviewDay, WeeklySummariesCard } from './weekly-summaries-card';

const FRIDAY = new Date('2026-10-23T08:00:00Z');
const WEDNESDAY = new Date('2026-10-21T08:00:00Z');

function withCounts(weeklySummaries: number) {
  const client = new QueryClient();
  client.setQueryData(navCountsQuery.queryKey, { tasks: 0, tickets: 0, weeklySummaries });
  return (node: React.ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

describe('the home weekly summaries card', () => {
  beforeAll(async () => {
    await setLanguage('sk');
    await loadAllNamespaces();
  });

  it('the home shows Týždenné prehľady · Na kontrolu: 3 when counts.weeklySummaries is 3', async () => {
    await renderWithRouter(() => <WeeklySummariesCard now={FRIDAY} />, '/', withCounts(3));
    expect(screen.getByText('Týždenné prehľady')).toBeInTheDocument();
    expect(screen.getByText('Na kontrolu: 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skontrolovať' })).toHaveAttribute(
      'href',
      '/weekly-summaries',
    );
  });

  it('and nothing when 0 or midweek', async () => {
    await renderWithRouter(() => <WeeklySummariesCard now={FRIDAY} />, '/', withCounts(0));
    expect(screen.queryByText('Týždenné prehľady')).not.toBeInTheDocument();
    expect(isReviewDay(WEDNESDAY)).toBe(false);
    expect(isReviewDay(new Date('2026-10-19T08:00:00Z'))).toBe(true);
  });
});
