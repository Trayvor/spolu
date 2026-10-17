import { useDeferredValue, useId, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { formatMoney, type ContractRow } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ListSkeleton } from '@/components/ui/skeleton';
import type { FinanceView } from '../api';
import { formatPeriod, hasEnded, isEndingSoon, today as todayOf } from '../documents/format';
import { FinanceCard, FinanceCardEmpty } from '../finance-card';
import { ClientMark } from './client-mark';
import { CONTRACT_ORDERS, contractsQuery, logoUrl, type ContractOrder } from './system-api';

const ORDERS = Object.keys(CONTRACT_ORDERS) as ContractOrder[];

/**
 * Contracts across clients (spec §6.2, owner decision 16): the chosen clients' contracts as a
 * ledger — client, number and title, period with the "Ending soon" / "Ended" marks, amount in
 * tabular figures — sorted by start, end or amount, 30 a page. The search covers every finance
 * document and note of those clients too. A row opens the item in its client's Finance tab.
 * From 641 px a table; on phones each row stacks into two lines.
 */
export function ContractsCard({ view }: { view: FinanceView }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const searchId = useId();
  const sortId = useId();
  const [order, setOrder] = useState<ContractOrder>('start');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const query = useInfiniteQuery(contractsQuery(view, order, q.length >= 2 ? q : ''));
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const today = todayOf();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`financeSystem.contracts.${key}`, options);

  let body;
  if (query.isPending) {
    body = (
      <div aria-busy="true">
        <ListSkeleton rows={5} />
      </div>
    );
  } else if (query.isError) {
    body = (
      <div className="m-auto flex flex-col items-center gap-3 py-8 text-center">
        <p role="alert" className="text-button text-muted-foreground">
          {t('financeSystem.loadFailed')}
        </p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          {t('financeSystem.retry')}
        </Button>
      </div>
    );
  } else if (rows.length === 0) {
    body = <FinanceCardEmpty>{q.length >= 2 ? k('noMatch', { q }) : k('empty')}</FinanceCardEmpty>;
  } else {
    body = (
      <>
        <table className="w-full border-collapse text-left text-tiny max-[640px]:block">
          <thead className="max-[640px]:sr-only">
            <tr className="border-b-2 border-border text-micro text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-semibold">
                {k('columns.client')}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {k('columns.contract')}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {k('columns.period')}
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                {k('columns.amount')}
              </th>
            </tr>
          </thead>
          <tbody className="max-[640px]:block">
            {rows.map((row) => (
              <Row key={row.id} row={row} today={today} language={i18n.language} />
            ))}
          </tbody>
        </table>
        {query.hasNextPage && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 self-center"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('financeSystem.contracts.showMore')}
          </Button>
        )}
      </>
    );
  }

  return (
    <FinanceCard
      title={t('finance.cards.contracts')}
      titleId={titleId}
      className="flex-1"
      actions={
        <>
          <label htmlFor={sortId} className="sr-only">
            {k('sortLabel')}
          </label>
          <Select
            id={sortId}
            value={order}
            onChange={(e) => setOrder(e.target.value as ContractOrder)}
            className="h-9 py-0 pr-9 pl-3 text-tiny"
          >
            {ORDERS.map((o) => (
              <option key={o} value={o}>
                {k(`sort.${o}`)}
              </option>
            ))}
          </Select>
        </>
      }
    >
      <div className="pb-3">
        <label htmlFor={searchId} className="sr-only">
          {k('search')}
        </label>
        <Input
          id={searchId}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={k('search')}
          className="py-2"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </FinanceCard>
  );
}

function Row({ row, today, language }: { row: ContractRow; today: string; language: string }) {
  const { t } = useTranslation();
  const contract = row.contract;
  const soon = contract !== null && isEndingSoon(contract.endsOn, today);
  const ended = contract !== null && hasEnded(contract.endsOn, today);
  return (
    <tr
      className="border-b border-border last:border-b-0 max-[640px]:grid max-[640px]:grid-cols-[1fr_auto] max-[640px]:gap-x-3 max-[640px]:py-2.5"
      data-testid="contract-row"
    >
      <td className="py-2.5 pr-3 align-top max-[640px]:col-span-2 max-[640px]:p-0">
        <span className="flex min-w-0 items-center gap-2">
          <ClientMark name={row.groupName} logoUrl={logoUrl(row)} />
          <span className="truncate font-semibold">{row.groupName}</span>
        </span>
      </td>
      <td className="py-2.5 pr-3 align-top max-[640px]:p-0 max-[640px]:pt-1">
        <Link
          to="/groups/$groupId/finance"
          params={{ groupId: row.groupId }}
          search={{ item: row.id }}
          className="flex min-w-0 items-baseline gap-2 hover:underline"
        >
          {contract?.contractNumber && (
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {contract.contractNumber}
            </span>
          )}
          <span className="truncate">{row.title}</span>
          {!contract && (
            <span className="shrink-0 text-muted-foreground">
              ({t(`financeSystem.contracts.kinds.${row.type}`)})
            </span>
          )}
        </Link>
      </td>
      <td className="py-2.5 pr-3 align-top text-muted-foreground tabular-nums max-[640px]:col-span-2 max-[640px]:row-start-3 max-[640px]:p-0 max-[640px]:pt-0.5">
        {contract && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {formatPeriod(contract.startsOn, contract.endsOn, language)}
            {soon && (
              <span className="rounded-full bg-attention px-2 text-micro font-semibold text-attention-foreground">
                {t('financeDocuments.row.endingSoon')}
              </span>
            )}
            {ended && <span>{t('financeDocuments.row.ended')}</span>}
          </span>
        )}
      </td>
      <td className="py-2.5 text-right align-top font-semibold whitespace-nowrap tabular-nums max-[640px]:p-0 max-[640px]:pt-1">
        {contract && formatMoney(contract.amount, language, { whole: true })}
      </td>
    </tr>
  );
}
