import { useDeferredValue, useId, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { LinkedCost, LinkedDocument } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { contractsQuery } from '../system/system-api';
import { linkDocument, unlinkDocument, type CostTarget } from './api';

const EVERY_CLIENT = { kind: 'all', clients: [] } as const;

/**
 * The finance documents linked to a salary or an expense (2026-10-21): each with its client (or
 * the organisation) and **Odpojiť**, then **Prepojiť dokument**, a search over every finance
 * document (the ledger's search, from 2 characters) whose results link with one click. Needs the
 * `financeOrg` namespace.
 */
export function LinkedDocuments({
  target,
  documents,
  onChanged,
}: {
  target: CostTarget;
  documents: readonly LinkedDocument[];
  /** After a link or an unlink: the sheet refetches. */
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const s = (key: string, options?: Record<string, unknown>) =>
    t(`financeOrg.salaries.${key}`, options);
  const searchId = useId();
  const [picking, setPicking] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useDeferredValue(text.trim());
  const searching = picking && q.length >= 2;
  const results = useInfiniteQuery({
    ...contractsQuery(EVERY_CLIENT, 'start', q, null, 'document'),
    enabled: searching,
  });
  const linked = new Set(documents.map((d) => d.id));
  const found = (results.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (row) => row.type === 'document' && !linked.has(row.id),
  );

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch {
      setError(s('linkFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2" data-testid="linked-documents">
      <h3 className="text-button font-semibold">{s('documents')}</h3>
      {documents.length === 0 ? (
        <p className="text-tiny text-muted-foreground">{s('noDocuments')}</p>
      ) : (
        <ul className="flex flex-col">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 border-b border-border py-2 text-button last:border-b-0"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{d.title}</span>
                <span className="truncate text-micro text-muted-foreground">
                  {d.groupName ?? t('financeOrg.row.organisation')}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={s('unlinkLabel', { name: d.title })}
                onClick={() => void run(() => unlinkDocument(target, d.id))}
              >
                {s('unlink')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {picking ? (
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
          <label htmlFor={searchId} className="text-tiny font-semibold">
            {s('searchDocuments')}
          </label>
          <Input
            id={searchId}
            type="search"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={s('searchHint')}
            className="py-2"
          />
          {searching && !results.isPending && found.length === 0 && (
            <p className="text-tiny text-muted-foreground">{s('noMatch', { q })}</p>
          )}
          {found.length > 0 && (
            <ul className="flex flex-col">
              {found.slice(0, 10).map((row) => (
                <li key={row.id} className="flex items-center gap-3 py-1.5 text-button">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{row.title}</span>
                    <span className="truncate text-micro text-muted-foreground">
                      {row.groupId ? row.groupName : t('financeOrg.row.organisation')}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void run(async () => {
                        await linkDocument(target, row.id);
                        setText('');
                        setPicking(false);
                      })
                    }
                  >
                    {s('link')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => {
              setPicking(false);
              setText('');
            }}
          >
            {t('financeDocuments.sheet.cancel')}
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => setPicking(true)}
        >
          {s('linkDocument')}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-button text-error-ink">
          {error}
        </p>
      )}
    </section>
  );
}

/** A document's links (its sheet on `/finance`): the salaries and expenses it belongs to. */
export function LinkedCosts({ costs }: { costs: readonly LinkedCost[] }) {
  const { t } = useTranslation();
  const s = (key: string, options?: Record<string, unknown>) =>
    t(`financeOrg.salaries.${key}`, options);
  if (costs.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" data-testid="linked-costs">
      <h3 className="text-button font-semibold">{s('linkedTo')}</h3>
      <ul className="flex flex-col gap-1 text-button">
        {costs.map((c) => (
          <li key={`${c.kind}:${c.id}`}>
            <Link
              to="/finance"
              search={c.kind === 'salary' ? { salary: c.id } : { item: c.id }}
              className="hover:underline"
            >
              {c.kind === 'salary'
                ? s('salaryLabel', { label: c.label })
                : s('expenseLabel', { label: c.label })}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
