import { lazy, Suspense, useDeferredValue, useId, useState, type ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  formatMoney,
  type ContractRow,
  type FinanceItemType,
  type LedgerType,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ListSkeleton } from '@/components/ui/skeleton';
import { withNamespaces } from '@/i18n/namespaces';
import { useUpdateSearch } from '@/lib/use-update-search';
import { cn } from '@/lib/utils';
import type { FinanceView } from '../api';
import type { MonthRange } from '../period';
import { ORG_OWNER } from '../documents/api';
import {
  formatDay,
  formatPeriod,
  hasEnded,
  isEndingSoon,
  itemTitle,
  today as todayOf,
} from '../documents/format';
import { NewMenu, ORG_ITEM_KINDS } from '../documents/new-menu';
import { FinanceCard, FinanceCardEmpty } from '../finance-card';
import { ClientMark } from './client-mark';
import { CONTRACT_ORDERS, contractsQuery, logoUrl, type ContractOrder } from './system-api';

const ItemSheet = lazy(
  withNamespaces(['reminders', 'forms', 'chat', 'knowledge'], () =>
    import('../documents/item-sheet').then((m) => ({ default: m.ItemSheet })),
  ),
);

const ORDERS = Object.keys(CONTRACT_ORDERS) as ContractOrder[];

/** The ledger's type filter (decision E12): contracts first, as before part E. */
const TYPES: LedgerType[] = ['contract', 'expense', 'document', 'note', 'all'];

const pill =
  "relative inline-flex h-8 items-center rounded-full px-3.5 text-tiny font-semibold before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']";

/**
 * The ledger across clients (spec §6.2, owner decision 16; Phase 32 E decision E12): the chosen
 * clients' contracts — client, number and title, period with the "Ending soon" / "Ended" marks,
 * amount in tabular figures — and, by the type filter, their documents and notes, the
 * organisation's expenses or every kind; sorted by start, end or amount, 30 a page. The search
 * covers every finance item. A client's item opens in its client's Finance tab; an item of the
 * organisation (an expense, a contract of several clients) opens here, in the item sheet. From
 * 641 px a table; on phones each row stacks into lines.
 */
export function ContractsCard({
  view,
  range = null,
  title,
  headerStart,
}: {
  view: FinanceView;
  /** The page period: the contracts running in it (null: all); a search ignores it. */
  range?: MonthRange | null;
  title?: string;
  /** Controls before the card's own (`/finance`'s view switch). */
  headerStart?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const searchId = useId();
  const sortId = useId();
  const navigate = useNavigate();
  const updateSearch = useUpdateSearch();
  const search = useSearch({ strict: false }) as { item?: unknown };
  const openId = typeof search.item === 'string' && search.item ? search.item : null;
  const [type, setType] = useState<LedgerType>('contract');
  const [order, setOrder] = useState<ContractOrder>('start');
  const [text, setText] = useState('');
  const [creating, setCreating] = useState<FinanceItemType | null>(null);
  const [gone, setGone] = useState(false);
  const q = useDeferredValue(text.trim());
  const searching = q.length >= 2;
  const query = useInfiniteQuery(
    contractsQuery(view, order, searching ? q : '', searching ? null : range, type),
  );
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const today = todayOf();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`financeSystem.contracts.${key}`, options);

  const openHere = (id: string) => {
    setGone(false);
    updateSearch((s) => void (s.item = id), { replace: false });
  };
  const closeSheet = (created?: { id: string; groupId: string | null }) => {
    setCreating(null);
    if (created && created.groupId !== null) {
      void navigate({
        to: '/groups/$groupId/finance',
        params: { groupId: created.groupId },
        search: { item: created.id },
      });
    } else if (created) updateSearch((s) => void (s.item = created.id), { replace: false });
    else if (openId) updateSearch((s) => void delete s.item, { replace: false });
  };
  const sheet = creating
    ? ({ mode: 'create', type: creating } as const)
    : openId
      ? ({ mode: 'view', id: openId } as const)
      : null;

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
    body = (
      <FinanceCardEmpty>
        {searching
          ? k('noMatch', { q })
          : type !== 'contract'
            ? t(`financeOrg.ledger.empty.${type}`)
            : range
              ? k('emptyPeriod')
              : k('empty')}
      </FinanceCardEmpty>
    );
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
                {type === 'contract' ? k('columns.contract') : t('financeOrg.ledger.item')}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {type === 'expense' ? t('financeOrg.ledger.date') : k('columns.period')}
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                {k('columns.amount')}
              </th>
            </tr>
          </thead>
          <tbody className="max-[640px]:block">
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                today={today}
                language={i18n.language}
                onOpen={openHere}
              />
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
      title={title ?? t('finance.cards.contracts')}
      titleId={titleId}
      className="flex-1"
      actions={
        <>
          {headerStart}
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
          <NewMenu kinds={ORG_ITEM_KINDS} onPick={(pick) => setCreating(pick)} />
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-3">
        <div
          role="group"
          aria-label={t('financeOrg.ledger.types')}
          className="flex flex-wrap gap-1.5"
        >
          {TYPES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={type === option}
              onClick={() => setType(option)}
              className={cn(
                pill,
                type === option
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-surface-3',
              )}
            >
              {t(`financeOrg.ledger.type.${option}`)}
            </button>
          ))}
        </div>
        <label htmlFor={searchId} className="sr-only">
          {k('search')}
        </label>
        <Input
          id={searchId}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={k('search')}
          className="py-2"
        />
        {gone && (
          <p role="status" className="rounded-lg bg-secondary p-3 text-button font-semibold">
            {t('financeDocuments.card.itemGone')}
          </p>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      <Suspense fallback={null}>
        {sheet && (
          <ItemSheet
            key={sheet.mode === 'view' ? sheet.id : `new-${sheet.type}`}
            owner={ORG_OWNER}
            target={sheet}
            folderId={null}
            onClose={closeSheet}
            onUnavailable={() => {
              setGone(true);
              closeSheet();
            }}
          />
        )}
      </Suspense>
    </FinanceCard>
  );
}

/** The client cell: a client, the organisation, or a payer with its clients (Phase 32 E). */
function ClientCell({ row }: { row: ContractRow }) {
  const { t } = useTranslation();
  const shared = row.contract?.shared ?? null;
  if (row.groupId !== null) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <ClientMark name={row.groupName} logoUrl={logoUrl(row)} />
        <span className="truncate font-semibold">{row.groupName}</span>
      </span>
    );
  }
  const name = shared ? shared.payerName : t('financeOrg.row.organisation');
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ClientMark name={name} logoUrl={null} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{name}</span>
        {shared && (
          <span className="truncate text-micro text-muted-foreground">
            {t('financeOrg.row.clients', { count: shared.shares.length })}
          </span>
        )}
      </span>
    </span>
  );
}

function Row({
  row,
  today,
  language,
  onOpen,
}: {
  row: ContractRow;
  today: string;
  language: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const contract = row.contract;
  const expense = row.expense;
  const soon = contract !== null && isEndingSoon(contract.endsOn, today);
  const ended = contract !== null && hasEnded(contract.endsOn, today);
  const amount = contract?.shared?.total ?? contract?.amount ?? expense?.amount ?? null;
  const label = (
    <>
      {contract?.contractNumber && (
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {contract.contractNumber}
        </span>
      )}
      <span className="truncate">{itemTitle(row, t)}</span>
      {!contract && !expense && (
        <span className="shrink-0 text-muted-foreground">
          ({t(`financeSystem.contracts.kinds.${row.type}`)})
        </span>
      )}
    </>
  );
  const linkClass = 'flex min-w-0 items-baseline gap-2 text-left hover:underline';
  return (
    <tr
      className="border-b border-border last:border-b-0 max-[640px]:grid max-[640px]:grid-cols-[1fr_auto] max-[640px]:gap-x-3 max-[640px]:py-2.5"
      data-testid="contract-row"
    >
      <td className="py-2.5 pr-3 align-top max-[640px]:col-span-2 max-[640px]:p-0">
        <ClientCell row={row} />
      </td>
      <td className="py-2.5 pr-3 align-top max-[640px]:p-0 max-[640px]:pt-1">
        {row.groupId !== null ? (
          <Link
            to="/groups/$groupId/finance"
            params={{ groupId: row.groupId }}
            search={{ item: row.id }}
            className={linkClass}
          >
            {label}
          </Link>
        ) : (
          <button type="button" onClick={() => onOpen(row.id)} className={linkClass}>
            {label}
          </button>
        )}
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
        {expense && (
          <span>
            {formatDay(expense.spentOn, language)}
            {expense.spentOn > today && ` · ${t('financeOrg.row.planned')}`}
          </span>
        )}
      </td>
      <td className="py-2.5 text-right align-top font-semibold whitespace-nowrap tabular-nums max-[640px]:p-0 max-[640px]:pt-1">
        {amount && (
          <>
            {expense && '−'}
            {formatMoney(amount, language, { whole: true })}
          </>
        )}
      </td>
    </tr>
  );
}
