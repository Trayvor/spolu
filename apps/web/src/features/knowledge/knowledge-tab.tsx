import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useParams, useSearch } from '@tanstack/react-router';
import { KnowledgeTypes, type KnowledgeCreatableType, type KnowledgeType } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUpdateSearch } from '@/lib/use-update-search';
import { cn } from '@/lib/utils';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { groupFoldersQuery, groupKnowledgeQuery } from './api';
import { FolderBrowser } from './folder-browser';
import { FolderDialog } from './folder-dialog';
import { KnowledgeDialog, type KnowledgeDialogTarget } from './knowledge-dialog';
import { KnowledgeList } from './knowledge-list';
import { NewItemMenu } from './new-item-menu';
import { ChatsCheckbox } from './chats-checkbox';
import { chatsFilter, formatTypes, isFlatList, parseTypes } from './search';
import { useKnowledgeEvents } from './use-knowledge-events';

/**
 * The tab's URL search: the list filter (`type`, the ticked types as one canonical comma list),
 * and the open item (`k`, "new" with `kind` to create).
 */
type KnowledgeTabSearch = {
  type?: string;
  q?: string;
  /** `all`: the task and ticket chats' files too (shown only with "From chat" ticked). */
  chats?: 'all';
  k?: string;
  kind?: KnowledgeCreatableType;
  /** The open folder; absent: the top level. */
  folder?: string;
};

/** A search runs from this many characters, after this many ms without typing. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

// 32 px pills with a 44 px tap area (a `before:` inset), as the manager toggle.
const pill =
  "relative inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-tiny font-semibold before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']";
const pillOn = 'bg-primary text-primary-foreground';
const pillOff = 'bg-secondary text-secondary-foreground hover:bg-surface-3';

/** The 16 px check of a ticked type pill (stroke 2.5, as on the manager toggle). */
function PillCheck() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-4 shrink-0">
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}

const PLURAL: Record<KnowledgeType, string> = {
  note: 'notes',
  file: 'files',
  link: 'links',
  reminder: 'reminders',
  chat_file: 'fromChat',
};

export function KnowledgeTab() {
  const { groupId } = useParams({ strict: false });
  return groupId ? <GroupKnowledge groupId={groupId} /> : null;
}

/** The group's knowledge: header, type pills (any set of types), search, the list, and the dialog from `?k`. */
function GroupKnowledge({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  // The route's `validateSearch` (router.tsx) has checked these.
  const { type, q, chats, k, kind, folder }: KnowledgeTabSearch = useSearch({ strict: false });
  const updateSearch = useUpdateSearch();
  const canSeeAdmins = isAdmin(useSession());
  const types = parseTypes(type);
  const folderId = folder ?? null;
  // Searching, or listing chat files (they are in no folder), lists every folder flat;
  // otherwise the open folder's items (FolderBrowser).
  const searching = isFlatList(q, types);
  const chatFiles = types.includes('chat_file');
  const flatFilter = { types, q, chats: chatsFilter(types, chats) };
  const filter = searching ? flatFilter : { types, folder: folderId };
  const query = useInfiniteQuery({
    ...groupKnowledgeQuery(groupId, flatFilter),
    enabled: searching,
  });
  const folders = useQuery(groupFoldersQuery(groupId)).data;
  const openFolderRow = folders?.find((f) => f.id === folderId) ?? null;
  const [notice, setNotice] = useState<'item' | 'folder' | null>(null);
  const [newFolder, setNewFolder] = useState(false);

  // The field shows what is typed; the URL gets it after the debounce, from 2 characters.
  // A `q` that changes from outside (Back, a link) replaces the text; our own writes do not.
  const [text, setText] = useState(q ?? '');
  const written = useRef(q);
  useEffect(() => {
    if (q === written.current) return;
    written.current = q;
    setText(q ?? '');
  }, [q]);
  useEffect(() => {
    const value = text.trim();
    const next = value.length >= MIN_QUERY ? value : undefined;
    if (next === q) return;
    const timer = setTimeout(() => {
      written.current = next;
      updateSearch(
        (s) => {
          if (next) s.q = next;
          else delete s.q;
        },
        { replace: true },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, q, updateSearch]);

  // Each tick is its own history entry, like the old single choice.
  const setTypes = (next: KnowledgeType[]) => {
    const value = formatTypes(next);
    updateSearch(
      (s) => {
        if (value) s.type = value;
        else delete s.type;
      },
      { replace: false },
    );
  };
  const toggleType = (option: KnowledgeType) =>
    setTypes(types.includes(option) ? types.filter((x) => x !== option) : [...types, option]);
  const clearFilters = () => {
    written.current = undefined;
    setText('');
    updateSearch(
      (s) => {
        delete s.type;
        delete s.q;
        delete s.chats;
      },
      { replace: false },
    );
  };
  const openFolder = useCallback(
    (id: string | null) => {
      setNotice(null);
      updateSearch(
        (s) => {
          if (id) s.folder = id;
          else delete s.folder;
        },
        { replace: false },
      );
    },
    [updateSearch],
  );
  const folderGone = useCallback(() => {
    setNotice('folder');
    updateSearch((s) => void delete s.folder, { replace: true });
  }, [updateSearch]);
  const open = (id: string) => {
    setNotice(null);
    updateSearch(
      (s) => {
        s.k = id;
        delete s.kind;
      },
      { replace: false },
    );
  };
  const setChats = (all: boolean) =>
    updateSearch(
      (s) => {
        if (all) s.chats = 'all';
        else delete s.chats;
      },
      { replace: false },
    );
  const create = (pick: KnowledgeCreatableType) => {
    setNotice(null);
    updateSearch(
      (s) => {
        s.k = 'new';
        s.kind = pick;
      },
      { replace: false },
    );
  };
  const close = useCallback(
    (createdId?: string) =>
      updateSearch(
        (s) => {
          delete s.kind;
          if (createdId) s.k = createdId;
          else delete s.k;
        },
        { replace: true },
      ),
    [updateSearch],
  );
  const unavailable = useCallback(() => {
    setNotice('item');
    close();
  }, [close]);

  const target: KnowledgeDialogTarget | null =
    k === 'new'
      ? kind
        ? { mode: 'create', type: kind, groupId, folderId }
        : null
      : k
        ? { mode: 'view', id: k }
        : null;
  useKnowledgeEvents(
    groupId,
    filter,
    target?.mode === 'view' ? target.id : undefined,
    unavailable,
    canSeeAdmins,
  );

  // `?k=new` without a valid kind has nothing to create: drop it.
  const bareNew = k === 'new' && !kind;
  useEffect(() => {
    if (bareNew) close();
  }, [bareNew, close]);

  const newMenu = (className?: string) => (
    <NewItemMenu onPick={create} onPickFolder={() => setNewFolder(true)} className={className} />
  );
  const filtered = Boolean(type || q);
  const empty = filtered ? (
    <div className="flex flex-col items-start gap-3 py-6">
      <p className="text-button text-muted-foreground">
        {q
          ? t('knowledge.tab.noMatch', { q })
          : t('knowledge.tab.noMatchType', { count: types.length })}
      </p>
      <Button variant="ghost" size="sm" onClick={clearFilters}>
        {t('knowledge.tab.clearFilters')}
      </Button>
    </div>
  ) : (
    <div className="flex flex-col items-start gap-3 py-6">
      <p className="max-w-prose text-button text-muted-foreground">{t('knowledge.tab.empty')}</p>
      {newMenu()}
    </div>
  );
  const folderEmpty = folderId ? (
    <p className="py-6 text-button text-muted-foreground">{t('knowledge.folders.emptyFolder')}</p>
  ) : (
    empty
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between">
        <h2 className="text-medium font-semibold">{t('knowledge.tab.title')}</h2>
        {newMenu('w-full min-[641px]:w-auto')}
      </div>
      <div className="flex flex-col gap-3 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between">
        <div role="group" aria-label={t('knowledge.tab.filters')} className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={types.length === 0}
            onClick={() => setTypes([])}
            className={cn(pill, types.length === 0 ? pillOn : pillOff)}
          >
            {t('knowledge.types.all')}
          </button>
          {KnowledgeTypes.map((option) => {
            const checked = types.includes(option);
            return (
              <button
                key={option}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggleType(option)}
                className={cn(pill, checked ? cn(pillOn, 'pl-3') : pillOff)}
              >
                {checked && <PillCheck />}
                {t(`knowledge.types.${PLURAL[option]}`)}
              </button>
            );
          })}
          {chatFiles && <ChatsCheckbox checked={chats === 'all'} onChange={setChats} />}
        </div>
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('knowledge.tab.search')}
          maxLength={200}
          aria-label={t('knowledge.tab.search')}
          className="min-[641px]:w-72"
        />
      </div>
      {notice && (
        <p role="status" className="rounded-lg bg-secondary p-3 text-button font-semibold">
          {notice === 'item' ? t('knowledge.detail.unavailable') : t('knowledge.folders.gone')}
        </p>
      )}
      {searching ? (
        <KnowledgeList query={query} onOpen={open} empty={empty} showPath />
      ) : (
        <FolderBrowser
          groupId={groupId}
          folderId={folderId}
          types={types}
          rootCrumbs={[{ key: 'top', label: t('knowledge.folders.top') }]}
          onOpenFolder={openFolder}
          onOpenItem={open}
          onFolderGone={folderGone}
          canSeeAdmins={canSeeAdmins}
          emptyHint={folderEmpty}
        />
      )}
      {newFolder && (
        <FolderDialog
          groupId={groupId}
          parent={openFolderRow}
          canChooseVisibility={canSeeAdmins}
          onDone={() => setNewFolder(false)}
          onClose={() => setNewFolder(false)}
        />
      )}
      {target && (
        <KnowledgeDialog
          key={target.mode === 'view' ? target.id : `new-${target.type}`}
          target={target}
          onClose={close}
          onUnavailable={unavailable}
        />
      )}
    </section>
  );
}
