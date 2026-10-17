import type { FinanceView } from '../api';
import { HoursRankingCard } from './hours-ranking-card';
import { PaidRankingCard } from './paid-ranking-card';

/**
 * The rankings under the grid of `/finance` (spec §6.2): clients by money paid and by hours or
 * cost, 50/50 from 641 px (stacked on phones, where the page shows them as the "Rankings"
 * segment).
 */
export function RankingsRow({ view }: { view: FinanceView }) {
  return (
    <div className="grid gap-4 min-[641px]:grid-cols-2">
      <PaidRankingCard view={view} />
      <HoursRankingCard view={view} />
    </div>
  );
}
