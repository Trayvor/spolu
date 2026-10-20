import { lazy, Suspense, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { withNamespaces } from '@/i18n/namespaces';
import { useRememberedState } from '@/lib/use-remembered-filters';
import { useUpdateSearch } from '@/lib/use-update-search';
import type { FinanceView } from '../api';
import { DocumentsCard } from '../documents-card';
import { ORG_OWNER } from '../documents/api';
import type { MonthRange } from '../period';
import { SalariesCard } from '../salaries/salaries-card';
import { SegmentedControl } from '../segmented-control';
import { ContractsCard } from './contracts-card';

const SalarySheet = lazy(
  withNamespaces(['forms'], () =>
    import('../salaries/salary-sheet').then((m) => ({ default: m.SalarySheet })),
  ),
);

const VIEWS = ['ledger', 'organisation', 'salaries'] as const;
type View = (typeof VIEWS)[number];

/**
 * `/finance`'s bottom-left card (Phase 32 E, decision E12), **Položky**: three views under one
 * title, the choice remembered per person. **Zoznam** is the ledger of every item of the chosen
 * clients (and, with every client, of the organisation) with its type filter; **Organizácia**
 * is the organisation's own items in its folders, like a client's Documents card; **Mzdy**
 * (2026-10-21) the admins' salaries of the page period. A salary's sheet opens from any view
 * (`?salary=`, the audit log's and a document's links).
 */
export function ItemsCard({ view, range }: { view: FinanceView; range: MonthRange | null }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useRememberedState<View>('finance.items.view', VIEWS);
  const shown = saved ?? 'ledger';
  const updateSearch = useUpdateSearch();
  const search = useSearch({ strict: false }) as { salary?: unknown };
  const openSalary = typeof search.salary === 'string' && search.salary ? search.salary : null;
  const [creating, setCreating] = useState<{ admin: string | null } | null>(null);
  const [gone, setGone] = useState(false);

  const openSalaryHere = (id: string) => {
    setGone(false);
    updateSearch((s) => void (s.salary = id), { replace: false });
  };
  const closeSalary = (createdId?: string) => {
    setCreating(null);
    if (createdId) updateSearch((s) => void (s.salary = createdId), { replace: false });
    else if (openSalary) updateSearch((s) => void delete s.salary, { replace: false });
  };

  const switcher = (
    <SegmentedControl
      label={t('financeOrg.card.views')}
      options={VIEWS.map((value) => ({ value, label: t(`financeOrg.card.${value}`) }))}
      value={shown}
      onChange={(next) => setSaved(next === 'ledger' ? null : next)}
      className="w-[300px]"
    />
  );
  const title = t('financeOrg.card.title');
  const sheet = creating
    ? ({ mode: 'create' } as const)
    : openSalary
      ? ({ mode: 'view', id: openSalary } as const)
      : null;
  return (
    <>
      {gone && (
        <p role="status" className="mb-2 rounded-lg bg-secondary p-3 text-button font-semibold">
          {t('financeOrg.salaries.gone')}
        </p>
      )}
      {shown === 'ledger' ? (
        <ContractsCard view={view} range={range} title={title} headerStart={switcher} />
      ) : shown === 'organisation' ? (
        <DocumentsCard owner={ORG_OWNER} title={title} headerStart={switcher} />
      ) : (
        <SalariesCard
          range={range}
          title={title}
          headerStart={switcher}
          onOpen={openSalaryHere}
          onCreate={(admin) => setCreating({ admin })}
        />
      )}
      <Suspense fallback={null}>
        {sheet && (
          <SalarySheet
            key={sheet.mode === 'view' ? sheet.id : 'new'}
            target={sheet}
            defaultPayee={creating?.admin ?? null}
            onClose={closeSalary}
            onUnavailable={() => {
              setGone(true);
              closeSalary();
            }}
          />
        )}
      </Suspense>
    </>
  );
}
