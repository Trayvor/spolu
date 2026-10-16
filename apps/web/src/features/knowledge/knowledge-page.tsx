import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { KnowledgeTypes, type KnowledgeType } from '@spolu/shared';
import type { KnowledgePageSearch } from './search';
import { ClientFilter, type ClientOption } from '@/components/client-filter';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Toast } from '@/components/ui/toast';
import { groupsQuery } from '@/features/groups/api';
import { useUpdateSearch } from '@/lib/use-update-search';
import { globalKnowledgeQuery, knowledgeScopeQuery } from './api';
import { KnowledgeDialog } from './knowledge-dialog';
import { KnowledgeList } from './knowledge-list';

/** The last explicit client choice, restored on a visit without parameters. */
export const CLIENTS_STORAGE_KEY = 'spolu.knowledge.clients';

function readStored(): string | null {
  try {
    return localStorage.getItem(CLIENTS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(clients: string | null) {
  try {
    if (clients === null) localStorage.removeItem(CLIENTS_STORAGE_KEY);
    else localStorage.setItem(CLIENTS_STORAGE_KEY, clients);
  } catch {
    // Private mode or blocked storage: the URL still holds the choice.
  }
}

const TYPE_LABEL: Record<KnowledgeType, string> = {
  note: 'knowledge.types.notes',
  file: 'knowledge.types.files',
  link: 'knowledge.types.links',
  reminder: 'knowledge.types.reminders',
};

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * The admins' global knowledge list (`/knowledge`): the client filter, a type menu and a search
 * over every client's items, newest first, each row with its group. Filters and the open item
 * (`?k`) live in the URL. No live updates: it refetches on focus and on opening.
 */
export function KnowledgePage() {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as KnowledgePageSearch;
  const update = useUpdateSearch();

  // A visit without parameters restores the last explicit client choice. Until the URL has it,
  // the stored value is used, so the default scope is never fetched first.
  const [stored] = useState(() => (Object.keys(search).length === 0 ? readStored() : null));
  const [restoring, setRestoring] = useState(stored !== null);
  useEffect(() => {
    if (stored !== null) update((s) => void (s.clients = stored), { replace: true });
  }, [stored, update]);
  // Once the URL carries it, the URL rules again (a later Reset must not bring it back).
  if (restoring && search.clients !== undefined) setRestoring(false);
  const clientsParam = restoring ? (stored ?? undefined) : search.clients;

  const groups = useQuery(groupsQuery).data;
  const scope = useQuery(knowledgeScopeQuery).data;
  const options = useMemo<ClientOption[]>(
    () =>
      (groups ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        logoUrl: group.hasLogo
          ? `/api/groups/${encodeURIComponent(group.id)}/logo?v=${encodeURIComponent(group.updatedAt)}`
          : null,
      })),
    [groups],
  );

  const clients = clientsParam === undefined ? null : clientsParam.split(',').filter(Boolean);
  const noClients = clients !== null && clients.length === 0;
  const query = useInfiniteQuery({
    ...globalKnowledgeQuery({ clients: clients ?? undefined, type: search.type, q: search.q }),
    enabled: !noClients,
    refetchOnWindowFocus: true,
  });

  const changeClients = (next: string[] | null) => {
    const value = next === null ? null : next.join(',');
    writeStored(value);
    update(
      (s) => {
        if (value === null) delete s.clients;
        else s.clients = value;
      },
      { replace: true },
    );
  };

  // The search field applies after 300 ms, from 2 characters.
  const [text, setText] = useState(search.q ?? '');
  useEffect(() => {
    const trimmed = text.trim();
    const q = trimmed.length >= 2 ? trimmed : undefined;
    if (q === search.q) return;
    const timer = setTimeout(
      () =>
        update(
          (s) => {
            if (q) s.q = q;
            else delete s.q;
          },
          { replace: true },
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [text, search.q, update]);

  const [unavailable, setUnavailable] = useState(false);
  const closeItem = () => update((s) => void delete s.k, { replace: false });

  const empty = (
    <p className="py-8 text-center text-button text-muted-foreground">
      {search.q ? t('knowledge.global.noMatch', { q: search.q }) : t('knowledge.global.empty')}
    </p>
  );

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <h1 className="text-medium leading-tight font-semibold">{t('knowledge.global.title')}</h1>

      <div
        role="group"
        aria-label={t('knowledge.global.filters')}
        className="flex flex-wrap items-center gap-2"
      >
        <ClientFilter
          groups={options}
          managedIds={scope?.managedGroupIds ?? null}
          value={clients}
          onChange={changeClients}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              {search.type ? t(TYPE_LABEL[search.type]) : t('knowledge.global.allTypes')}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={search.type ?? 'all'}
              onValueChange={(value) =>
                update(
                  (s) => {
                    if (value === 'all') delete s.type;
                    else s.type = value;
                  },
                  { replace: false },
                )
              }
            >
              <DropdownMenuRadioItem value="all">
                {t('knowledge.global.allTypes')}
              </DropdownMenuRadioItem>
              {KnowledgeTypes.map((type) => (
                <DropdownMenuRadioItem key={type} value={type}>
                  {t(TYPE_LABEL[type])}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <label className="relative w-full min-[641px]:ml-auto min-[641px]:w-[300px]">
          <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">
            <SearchIcon />
          </span>
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('knowledge.global.search')}
            aria-label={t('knowledge.global.search')}
            className="py-2 pl-10"
          />
        </label>
      </div>

      {noClients ? (
        empty
      ) : (
        <KnowledgeList
          query={query}
          onOpen={(id) => update((s) => void (s.k = id), { replace: false })}
          showGroup
          empty={empty}
        />
      )}

      {search.k && (
        <KnowledgeDialog
          key={search.k}
          target={{ mode: 'view', id: search.k }}
          onClose={closeItem}
          onUnavailable={() => {
            setUnavailable(true);
            update((s) => void delete s.k, { replace: true });
          }}
        />
      )}
      {unavailable && (
        <Toast onClose={() => setUnavailable(false)}>{t('knowledge.detail.unavailable')}</Toast>
      )}
    </div>
  );
}
