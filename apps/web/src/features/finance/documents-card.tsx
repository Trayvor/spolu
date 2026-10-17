import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import type { FinanceFolder, FinanceItemType } from '@spolu/shared';
import { MoreIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { withNamespaces } from '@/i18n/namespaces';
import { useUpdateSearch } from '@/lib/use-update-search';
import { cn } from '@/lib/utils';
import { Breadcrumbs } from '@/features/knowledge/breadcrumbs';
import { childFolders, folderPath } from '@/features/knowledge/folder-tree';
import { ChevronIcon, FolderIcon } from '@/features/knowledge/icons';
import { financeFoldersQuery, financeItemsQuery, type ItemsFilter } from './documents/api';
import { today as todayOf } from './documents/format';
import { ItemRow } from './documents/item-row';
import { NewMenu } from './documents/new-menu';
import { FinanceCard, FinanceCardEmpty } from './finance-card';

// The sheet and the folder dialogs load on first use, with the namespaces of the shared form
// pieces they reuse (reminders, files, the text toolbar, the knowledge folder dialogs).
const DIALOG_NAMESPACES = ['reminders', 'forms', 'chat', 'knowledge'];
const ItemSheet = lazy(
  withNamespaces(DIALOG_NAMESPACES, () =>
    import('./documents/item-sheet').then((m) => ({ default: m.ItemSheet })),
  ),
);
const FolderDialogs = lazy(
  withNamespaces(DIALOG_NAMESPACES, () =>
    import('./documents/folder-dialogs').then((m) => ({ default: m.FolderDialogs })),
  ),
);

/** A search runs from this many characters, after this many ms without typing. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

const FILTERS: { type: FinanceItemType | undefined; key: string }[] = [
  { type: undefined, key: 'all' },
  { type: 'contract', key: 'contracts' },
  { type: 'document', key: 'documents' },
  { type: 'note', key: 'notes' },
];

const pill =
  "relative inline-flex h-8 items-center rounded-full px-3.5 text-tiny font-semibold before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']";

export type FolderAction =
  | { kind: 'new'; parentId: string | null }
  | { kind: 'rename' | 'move' | 'delete'; folder: FinanceFolder };

/** What the sheet shows: an item (`?item=<id>`, also a notification's link) or a new one. */
type SheetTarget = { mode: 'view'; id: string } | { mode: 'create'; type: FinanceItemType };

/**
 * Documents (spec §6.1): one client's contracts, documents, notes and folders, the knowledge
 * tab's way in a smaller frame. Breadcrumbs and the open folder's folders first, then its items
 * newest first, 30 a page with "Show more"; a type filter or a search (from 2 characters) lists
 * every folder flat with each item's folder path. An item opens in a sheet from `?item=`.
 */
export function DocumentsCard({ groupId }: { groupId: string }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const updateSearch = useUpdateSearch();
  const search = useSearch({ strict: false }) as { item?: unknown };
  const openId = typeof search.item === 'string' && search.item ? search.item : null;

  const [openFolder, setFolder] = useState<string | null>(null);
  const [type, setType] = useState<FinanceItemType | undefined>(undefined);
  const [text, setText] = useState('');
  const [q, setQ] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState<FinanceItemType | null>(null);
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null);
  const [notice, setNotice] = useState<'item' | null>(null);

  useEffect(() => {
    const value = text.trim();
    const next = value.length >= MIN_QUERY ? value : undefined;
    const timer = setTimeout(() => setQ(next), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const folders = useQuery(financeFoldersQuery(groupId)).data;
  // The open folder was deleted (here or by someone else): the top level, with a notice.
  const folderGone =
    openFolder !== null && folders !== undefined && !folders.some((f) => f.id === openFolder);
  const folder = folderGone ? null : openFolder;
  const flat = q !== undefined || type !== undefined;
  const filter: ItemsFilter = flat ? { folder: null, type, q } : { folder };
  const items = useInfiniteQuery(financeItemsQuery(groupId, filter));

  const openItem = (id: string) => {
    setNotice(null);
    updateSearch((s) => void (s.item = id), { replace: false });
  };
  const closeSheet = (createdId?: string) => {
    setCreating(null);
    if (createdId) updateSearch((s) => void (s.item = createdId), { replace: false });
    else if (openId) updateSearch((s) => void delete s.item, { replace: false });
  };
  const sheet: SheetTarget | null = creating
    ? { mode: 'create', type: creating }
    : openId
      ? { mode: 'view', id: openId }
      : null;

  const today = todayOf();
  const rows = items.data?.pages.flatMap((page) => page.items) ?? [];
  const shownFolders = !flat && folders ? childFolders(folders, folder, i18n.language) : [];
  const crumbs = [
    { key: 'top', label: t('financeDocuments.card.top'), onClick: () => setFolder(null) },
    ...(folder && folders
      ? folderPath(folders, folder).map((f) => ({
          key: f.id,
          label: f.name,
          onClick: () => setFolder(f.id),
        }))
      : []),
  ];
  const clear = () => {
    setType(undefined);
    setText('');
    setQ(undefined);
  };

  let body;
  if (items.isPending) {
    body = (
      <p role="status" className="py-6 text-button text-muted-foreground">
        {t('financeDocuments.card.loading')}
      </p>
    );
  } else if (items.isError) {
    body = (
      <div className="flex flex-col items-start gap-3 py-6">
        <p className="text-button text-error-ink">{t('financeDocuments.card.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void items.refetch()}>
          {t('financeDocuments.card.retry')}
        </Button>
      </div>
    );
  } else if (rows.length === 0 && shownFolders.length === 0) {
    body = flat ? (
      <div className="flex flex-col items-start gap-3 py-6">
        <p className="text-button text-muted-foreground">
          {q ? t('financeDocuments.card.noMatch', { q }) : t('financeDocuments.card.noMatchType')}
        </p>
        <Button variant="ghost" size="sm" onClick={clear}>
          {t('financeDocuments.card.clear')}
        </Button>
      </div>
    ) : (
      <FinanceCardEmpty>
        {folder ? t('financeDocuments.card.emptyFolder') : t('financeDocuments.card.empty')}
      </FinanceCardEmpty>
    );
  } else {
    body = (
      <ul className="flex flex-col" aria-label={t('finance.cards.documents')}>
        {shownFolders.map((f) => (
          <FolderRow
            key={f.id}
            folder={f}
            onOpen={() => setFolder(f.id)}
            onAction={(kind) => setFolderAction({ kind, folder: f })}
          />
        ))}
        {rows.map((item) => (
          <ItemRow key={item.id} item={item} today={today} onOpen={openItem} />
        ))}
      </ul>
    );
  }

  return (
    <FinanceCard
      title={t('finance.cards.documents')}
      titleId={titleId}
      className="flex-1"
      actions={
        <NewMenu
          onPick={(pick) => {
            setNotice(null);
            setCreating(pick);
          }}
          onPickFolder={() => setFolderAction({ kind: 'new', parentId: flat ? null : folder })}
        />
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label={t('financeDocuments.card.filters')}
            className="flex flex-wrap gap-1.5"
          >
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={type === option.type}
                onClick={() => setType(option.type)}
                className={cn(
                  pill,
                  type === option.type
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-surface-3',
                )}
              >
                {t(`financeDocuments.card.${option.key}`)}
              </button>
            ))}
          </div>
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('financeDocuments.card.search')}
            aria-label={t('financeDocuments.card.search')}
            maxLength={100}
            className="ml-auto h-9 min-w-0 flex-1 basis-48 min-[641px]:max-w-64"
          />
        </div>
        {!flat && folder && <Breadcrumbs crumbs={crumbs} />}
        {(notice || folderGone) && (
          <p role="status" className="rounded-lg bg-secondary p-3 text-button font-semibold">
            {notice === 'item'
              ? t('financeDocuments.card.itemGone')
              : t('financeDocuments.card.folderGone')}
          </p>
        )}
      </div>
      {body}
      {items.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 self-center"
          aria-disabled={items.isFetchingNextPage}
          onClick={() => void items.fetchNextPage()}
        >
          {t('financeDocuments.card.showMore')}
        </Button>
      )}
      <Suspense fallback={null}>
        {sheet && (
          <ItemSheet
            key={sheet.mode === 'view' ? sheet.id : `new-${sheet.type}`}
            groupId={groupId}
            target={sheet}
            folderId={flat ? null : folder}
            onClose={closeSheet}
            onUnavailable={() => {
              setNotice('item');
              closeSheet();
            }}
          />
        )}
        {folderAction && (
          <FolderDialogs
            groupId={groupId}
            action={folderAction}
            folders={folders}
            onClose={() => setFolderAction(null)}
          />
        )}
      </Suspense>
    </FinanceCard>
  );
}

function FolderRow({
  folder,
  onOpen,
  onAction,
}: {
  folder: FinanceFolder;
  onOpen: () => void;
  onAction: (kind: 'rename' | 'move' | 'delete') => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        data-testid="finance-folder-row"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"
        >
          <FolderIcon />
        </span>
        <span className="min-w-0 flex-1 truncate text-button font-semibold">{folder.name}</span>
        <span className="text-muted-foreground">
          <ChevronIcon />
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('financeDocuments.card.folderActions', { name: folder.name })}
          className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent max-[640px]:size-11"
        >
          <MoreIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onAction('rename')}>
            {t('financeDocuments.card.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction('move')}>
            {t('financeDocuments.card.move')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction('delete')} className="text-error-ink">
            {t('financeDocuments.card.deleteFolder')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
