import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter, useSearch } from '@tanstack/react-router';
import { backOr, samePath } from '@/lib/back';
import { useTranslation } from 'react-i18next';
import { KnowledgeTypes, type KnowledgeType } from '@spolu/shared';
import {
  chatsFilter,
  formatTypes,
  isFlatList,
  parseTypes,
  type KnowledgePageSearch,
} from './search';
import { ChatsCheckbox } from './chats-checkbox';
import { Avatar } from '@/components/avatar';
import { ClientFilter, type ClientOption, toClientOptions } from '@/components/client-filter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Toast } from '@/components/ui/toast';
import { groupsQuery } from '@/features/groups/api';
import { useRememberedFilters } from '@/lib/use-remembered-filters';
import { useUpdateSearch } from '@/lib/use-update-search';
import { cn } from '@/lib/utils';
import { globalKnowledgeQuery, knowledgeScopeQuery } from './api';
import { KnowledgeDialog } from './knowledge-dialog';
import { KnowledgeList } from './knowledge-list';
import { FolderBrowser } from './folder-browser';
import { ChevronIcon } from './icons';
import { useKnowledgeView, ViewToggle } from './view-toggle';

/** The filters remembered for the next visit (`useRememberedFilters`): not the search. */
const REMEMBERED_KEYS = ['clients', 'type', 'chats'] as const;

/** The `clients` value meaning every client. */
const ALL = 'all';

/** The `q` a field text gives: trimmed, from 2 characters. */
const toQuery = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length >= 2 ? trimmed : undefined;
};

/** One client of the folder view's first level: opens its folders. */
function ClientRow({ client, onOpen }: { client: ClientOption; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => onOpen(client.id)}
      aria-label={t('knowledge.folders.open', { name: client.name })}
      className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5"
    >
      {client.logoUrl ? (
        <img src={client.logoUrl} alt="" className="size-10 shrink-0 rounded-full" />
      ) : (
        <Avatar userId={client.id} name={client.name} size={40} />
      )}
      <span className="min-w-0 flex-1 truncate text-button font-semibold">{client.name}</span>
      <span className="text-muted-foreground">
        <ChevronIcon />
      </span>
    </button>
  );
}

const TYPE_LABEL: Record<KnowledgeType, string> = {
  note: 'knowledge.types.notes',
  file: 'knowledge.types.files',
  link: 'knowledge.types.links',
  reminder: 'knowledge.types.reminders',
  meeting: 'knowledge.types.meetings',
  chat_file: 'knowledge.types.fromChat',
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
 * The admins' global knowledge (`/knowledge`): the client filter, a type menu (any set of types,
 * ticked in a menu that stays open) and a search. Without a search it is a folder view: the
 * clients of the filter, then one client's folders and items (`?at=<group>&folder=<id>`). With a
 * search it is one flat list over every client's items, newest first, each row with its group
 * and folder path. Filters, the place and the open item (`?k`) live in the URL. No live updates:
 * it refetches on focus and on opening.
 */
export function KnowledgePage() {
  const { t, i18n } = useTranslation();
  // A visit without filters gets the person's last ones (clients, types, chat files); until the
  // URL has them they are already in `search`, so the default scope is never fetched first.
  const search = useRememberedFilters(
    'knowledge',
    REMEMBERED_KEYS,
    useSearch({ strict: false }) as KnowledgePageSearch,
  );
  const update = useUpdateSearch();
  const [view, setView] = useKnowledgeView();
  const clientsParam = search.clients;

  const groups = useQuery(groupsQuery).data;
  const scope = useQuery(knowledgeScopeQuery).data;
  const options = useMemo<ClientOption[]>(() => toClientOptions(groups ?? [], true), [groups]);

  const loaded = groups !== undefined && scope !== undefined;
  const allIds = options.map((group) => group.id);
  // `clients=all` is every client, now and later; any other value is a list of ids.
  const everyClient = clientsParam === ALL;
  const clients =
    clientsParam === undefined
      ? null
      : everyClient
        ? allIds
        : clientsParam.split(',').filter(Boolean);
  const noClients = clients !== null && !everyClient && clients.length === 0;
  // Without a `clients` param the server uses the default scope (the managed clients, or every
  // client while the admin manages none); `scope=all` is every client without sending the ids.
  const managedIds = scope?.managedGroupIds ?? null;
  const types = parseTypes(search.type);
  // Searching, or listing chat files (in no folder), lists every client's items flat;
  // otherwise the folder view (client → folders).
  const searching = isFlatList(search.q, types);
  const chats = chatsFilter(types, search.chats);
  const query = useInfiniteQuery({
    ...globalKnowledgeQuery(
      everyClient
        ? { scope: 'all', types, q: search.q, chats }
        : { clients: clients ?? undefined, types, q: search.q, chats },
    ),
    enabled: !noClients && searching,
    refetchOnWindowFocus: true,
  });

  // The folder view's first level: the clients of the filter (the default scope is the managed
  // clients, or every client while the admin manages none), by name.
  const shownIds =
    clients !== null
      ? new Set(clients)
      : managedIds && managedIds.length > 0
        ? new Set(managedIds)
        : null;
  const collator = new Intl.Collator(i18n.language, { sensitivity: 'base' });
  const shownClients = options
    .filter((option) => shownIds === null || shownIds.has(option.id))
    // The admin group "eGrant tím" first (Phase 34), then the clients by name.
    .sort(
      (a, b) => Number(!!b.internal) - Number(!!a.internal) || collator.compare(a.name, b.name),
    );
  const openClient = options.find((option) => option.id === search.at) ?? null;
  const goTo = (at: string | undefined, folder: string | undefined) =>
    update(
      (s) => {
        if (at) s.at = at;
        else delete s.at;
        if (folder) s.folder = folder;
        else delete s.folder;
      },
      { replace: false },
    );
  const folderGone = useCallback(
    () => update((s) => void delete s.folder, { replace: true }),
    [update],
  );

  const changeClients = (next: string[] | null) => {
    const value =
      next === null
        ? null
        : allIds.length > 0 && allIds.every((id) => next.includes(id))
          ? ALL
          : next.join(',');
    update(
      (s) => {
        if (value === null) delete s.clients;
        else s.clients = value;
      },
      { replace: true },
    );
  };

  // The search field applies after 300 ms, from 2 characters, and only from typing: a `q` that
  // changes in the URL (Back, a link) is copied into the field and cancels a pending write.
  const [text, setText] = useState(search.q ?? '');
  const [seenQ, setSeenQ] = useState(search.q);
  if (search.q !== seenQ) {
    setSeenQ(search.q);
    if (toQuery(text) !== search.q) setText(search.q ?? '');
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (pending.current !== search.q) clearTimeout(timer.current);
  }, [search.q]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const changeText = (next: string) => {
    setText(next);
    clearTimeout(timer.current);
    const q = toQuery(next);
    if (q === search.q) return;
    pending.current = q;
    timer.current = setTimeout(
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
  };

  // Ticking keeps the menu open; every tick is its own history entry, like the old radio choice.
  const changeTypes = (next: KnowledgeType[]) => {
    const value = formatTypes(next);
    update(
      (s) => {
        if (value) s.type = value;
        else delete s.type;
      },
      { replace: false },
    );
  };
  const typeLabel =
    types.length === 0
      ? t('knowledge.global.allTypes')
      : types.length === 1
        ? t(TYPE_LABEL[types[0]!])
        : t('knowledge.global.typesCount', { count: types.length });

  const [unavailable, setUnavailable] = useState(false);
  const router = useRouter();
  // Back to the list the item was opened from (Back does not reopen it), else drop `k` in place.
  const closeItem = () =>
    backOr(
      router,
      () => update((s) => void delete s.k, { replace: true }),
      samePath(router, ['k']),
    );

  const empty = (
    <p className="py-8 text-center text-button text-muted-foreground">
      {search.q ? t('knowledge.global.noMatch', { q: search.q }) : t('knowledge.global.empty')}
    </p>
  );

  return (
    // Cards get a wider page: up to three columns.
    <div
      className={cn('flex flex-col gap-6', view === 'cards' ? 'max-w-[1120px]' : 'max-w-[720px]')}
    >
      <h1 className="text-medium leading-tight font-semibold">{t('knowledge.global.title')}</h1>

      <div
        role="group"
        aria-label={t('knowledge.global.filters')}
        className="flex flex-wrap items-center gap-2"
      >
        <ClientFilter
          groups={options}
          managedIds={managedIds}
          value={clients}
          onChange={changeClients}
          disabled={!loaded}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              {typeLabel}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuCheckboxItem
              checked={types.length === 0}
              onCheckedChange={() => changeTypes([])}
            >
              {t('knowledge.global.allTypes')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {KnowledgeTypes.map((type) => (
              <DropdownMenuCheckboxItem
                key={type}
                checked={types.includes(type)}
                onCheckedChange={(checked) =>
                  changeTypes(checked ? [...types, type] : types.filter((x) => x !== type))
                }
              >
                {t(TYPE_LABEL[type])}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {types.includes('chat_file') && (
          <ChatsCheckbox
            checked={search.chats === 'all'}
            onChange={(all) =>
              update(
                (s) => {
                  if (all) s.chats = 'all';
                  else delete s.chats;
                },
                { replace: false },
              )
            }
          />
        )}
        <div className="flex w-full items-center gap-2 min-[641px]:ml-auto min-[641px]:w-auto">
          <label className="relative min-w-0 flex-1 min-[641px]:w-[300px] min-[641px]:flex-none">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">
              <SearchIcon />
            </span>
            <Input
              type="search"
              value={text}
              onChange={(event) => changeText(event.target.value)}
              placeholder={t('knowledge.global.search')}
              maxLength={200}
              aria-label={t('knowledge.global.search')}
              className="py-2 pl-10"
            />
          </label>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {searching ? (
        noClients ? (
          empty
        ) : (
          <KnowledgeList
            query={query}
            onOpen={(id) => update((s) => void (s.k = id), { replace: false })}
            showGroup
            showPath
            empty={empty}
            view={view}
          />
        )
      ) : search.at ? (
        <FolderBrowser
          key={search.at}
          groupId={search.at}
          folderId={search.folder ?? null}
          types={types}
          rootCrumbs={[
            {
              key: 'all',
              label: t('knowledge.folders.allClients'),
              onClick: () => goTo(undefined, undefined),
            },
            { key: search.at, label: openClient?.name ?? '…' },
          ]}
          onOpenFolder={(id) => goTo(search.at, id ?? undefined)}
          onOpenItem={(id) => update((s) => void (s.k = id), { replace: false })}
          onFolderGone={folderGone}
          canSeeAdmins
          view={view}
          emptyHint={
            <p className="py-6 text-button text-muted-foreground">
              {t('knowledge.folders.emptyFolderBrowse')}
            </p>
          }
        />
      ) : !loaded ? (
        <Card
          role="status"
          aria-busy="true"
          className="h-24 w-full animate-skeleton bg-muted"
          aria-label={t('knowledge.list.loading')}
        />
      ) : shownClients.length === 0 ? (
        <p className="py-8 text-center text-button text-muted-foreground">
          {t('knowledge.folders.noClients')}
        </p>
      ) : (
        <Card className="w-full gap-0 divide-y divide-border overflow-hidden py-0">
          {shownClients.map((client) => (
            <ClientRow key={client.id} client={client} onOpen={(id) => goTo(id, undefined)} />
          ))}
        </Card>
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
