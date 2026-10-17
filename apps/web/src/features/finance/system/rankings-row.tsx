import type { FinanceView } from '../api';
import type { MonthRange } from '../period';
import { HoursRankingCard } from './hours-ranking-card';
import { PaidRankingCard } from './paid-ranking-card';

/**
 * The rankings under the grid of `/finance` (spec §6.2), both over the page period: clients by
 * money paid and by hours or cost, 50/50 from 641 px (stacked on phones, where the page shows them as the "Rankings"
 * segment).
 */
export function RankingsRow({ view, range }: { view: FinanceView; range: MonthRange | null }) {
  return (
    <div className="grid gap-4 min-[641px]:grid-cols-2">
      <PaidRankingCard view={view} range={range} />
      <HoursRankingCard view={view} range={range} />
    </div>
  );
}
