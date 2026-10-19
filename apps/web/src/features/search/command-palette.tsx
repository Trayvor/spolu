import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { MessageSearchPage, SearchResults } from '@spolu/shared';
import { useSession } from '@/features/auth/use-session';
import { ApiError, apiGet, type ResponseParser } from '@/lib/api';
import { useBackCloses } from '@/lib/use-back-closes';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { useScrollLock } from '@/lib/use-scroll-lock';
import { Highlighted } from './message-hit';
import {
  fold,
  messageItems,
  quickActions,
  readRecent,
  rememberRecent,
  resultSections,
  type PaletteItem,
  type PaletteKind,
  type PaletteSection,
} from './model';

/** A pause in typing this long (ms) sends the search. */
const DEBOUNCE_MS = 150;
const MIN_QUERY = 2;
/** Messages need a term of 3 characters (the server's `SEARCH_LIMITS.minMessageTerm`). */
const MIN_MESSAGE_TERM = 3;
/** Every type but messages, which come from their own request. */
const SEARCH_TYPES = 'groups,tickets,tasks,knowledge,projects,people';
const FIRST_MESSAGES = 5;
const MORE_MESSAGES = 20;

/** The server's answer is trusted as typed (it is ours); no zod in this chunk. */
const resultsParser: ResponseParser<SearchResults> = {
  safeParse: (data) =>
    typeof data === 'object' && data !== null
      ? { success: true, data: data as SearchResults }
      : { success: false },
};

const pageParser: ResponseParser<MessageSearchPage> = {
  safeParse: (data) =>
    typeof data === 'object' && data !== null && Array.isArray((data as MessageSearchPage).hits)
      ? { success: true, data: data as MessageSearchPage }
      : { success: false },
};

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * The global search and quick switcher (Cmd/Ctrl+K, the header's search button), a lazy chunk.
 * A modal native `<dialog>`: a 640 px panel near the top from 641 px, a full-screen sheet on
 * phones. Empty, it lists the recently opened items and the quick actions; from 2 characters
 * it also asks `GET /api/search` (150 ms after typing pauses) and lists the hits per type, and
 * from a 3-character term `GET /api/search/messages` in parallel (the Správy section, last, with
 * "Zobraziť ďalšie správy" as a row that loads 20 more). The
 * input is a combobox: Up and Down move through every row, Enter opens the active one, Escape,
 * Back or a click on the backdrop close. Opening an item replaces the palette's history entry.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const user = useSession();
  const navigate = useNavigate();
  const groupId = useRouterState({
    select: (state) =>
      (state.matches[state.matches.length - 1]?.params as { groupId?: string } | undefined)
        ?.groupId,
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState<{ list: PaletteItem[]; index: number }>({
    list: [],
    index: 0,
  });
  const term = useDebounced(q.trim(), DEBOUNCE_MS);
  const searching = q.trim().length >= MIN_QUERY;
  useScrollLock(true);
  useBackCloses(true, onClose);
  // The topmost trap of the stack (`use-focus-trap.ts`), so a trapped panel under it (the task
  // panel on a phone) leaves Tab to the palette; the focus returns to the opener on close.
  useFocusTrap(dialog, true);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    // jsdom (tests) has no `showModal`.
    if (typeof node.showModal === 'function') node.showModal();
    else node.setAttribute('open', '');
    input.current?.focus();
  }, []);

  const results = useQuery({
    queryKey: ['search', term],
    queryFn: () =>
      apiGet(`/search?q=${encodeURIComponent(term)}&types=${SEARCH_TYPES}`, resultsParser),
    enabled: term.length >= MIN_QUERY,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
  // Messages (2026-10-19) in parallel, so a slow message search never holds the other sections:
  // the first 5, then 20 a page ("Zobraziť ďalšie správy").
  const messageTerm =
    term.length >= MIN_QUERY &&
    fold(term)
      .split(/\s+/)
      .some((w) => w.length >= MIN_MESSAGE_TERM);
  const messages = useInfiniteQuery({
    queryKey: ['search', 'messages', term],
    queryFn: ({ pageParam }) =>
      apiGet(
        `/search/messages?q=${encodeURIComponent(term)}${
          pageParam
            ? `&limit=${MORE_MESSAGES}&cursor=${encodeURIComponent(pageParam)}`
            : `&limit=${FIRST_MESSAGES}`
        }`,
        pageParser,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: messageTerm,
    staleTime: 30_000,
    retry: false,
  });
  /** The row to select once the next page of messages is in: its first hit. */
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const [recent] = useState(() => (user ? readRecent(user.id) : []));
  const actions = useMemo(
    () =>
      (user ? quickActions(user, groupId) : []).map((a) => ({ ...a, label: t(a.labelKey ?? '') })),
    [user, groupId, t],
  );

  const { data: messageData, hasNextPage, fetchNextPage } = messages;
  const messageSection = useMemo((): PaletteSection => {
    const section: PaletteSection = { key: 'messages', items: [] };
    if (term.length < MIN_QUERY) return section;
    if (!messageTerm) return { ...section, note: t('search.messages.minLength') };
    const pages = messageData?.pages ?? [];
    if (pages.some((page) => page.tooBroad)) {
      return { ...section, note: t('search.messages.tooBroad') };
    }
    const items = messageItems(
      pages.flatMap((page) => page.hits),
      t,
      i18n.language,
    );
    if (hasNextPage) {
      items.push({
        key: 'more:messages',
        kind: 'more',
        label: t('search.messages.more'),
        link: { to: '' },
        onSelect: () => {
          void fetchNextPage().then((next) => {
            const first = next.data?.pages.at(-1)?.hits[0];
            if (first) setFocusKey(`message:${first.id}`);
          });
        },
      });
    }
    return { ...section, items };
  }, [term, messageTerm, messageData, hasNextPage, fetchNextPage, t, i18n.language]);

  const sections = useMemo((): PaletteSection[] => {
    if (!searching) {
      return [
        { key: 'recent', items: recent },
        { key: 'actions', items: actions },
      ].filter((s) => s.items.length > 0);
    }
    const needle = fold(q);
    const matching = actions.filter((a) => fold(a.label).includes(needle));
    const hits = results.data && term.length >= MIN_QUERY ? resultSections(results.data) : [];
    return [{ key: 'actions', items: matching }, ...hits, messageSection].filter(
      (s) => s.items.length > 0 || s.note,
    );
  }, [searching, recent, actions, q, results.data, term, messageSection]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  // The active row belongs to the list it was chosen in: a new list starts on its first row.
  // After "more", the first newly loaded hit.
  const index =
    active.list === flat
      ? active.index
      : Math.max(0, focusKey ? flat.findIndex((item) => item.key === focusKey) : 0);
  const current = flat[index];
  const select = (next: number) => setActive({ list: flat, index: next });

  useEffect(() => {
    if (!current) return;
    document.getElementById(optionId(listId, current.key))?.scrollIntoView?.({ block: 'nearest' });
  }, [current, listId]);

  const open = (item: PaletteItem) => {
    if (item.onSelect) {
      setActive({ list: flat, index });
      item.onSelect();
      return;
    }
    if (user) rememberRecent(user.id, item);
    onClose();
    void navigate({
      to: item.link.to,
      params: item.link.params,
      search: item.link.search,
      replace: true,
    } as never);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const count = flat.length;
    if (event.key === 'ArrowDown' && count > 0) {
      event.preventDefault();
      select((index + 1) % count);
    } else if (event.key === 'ArrowUp' && count > 0) {
      event.preventDefault();
      select((index - 1 + count) % count);
    } else if (event.key === 'Enter' && current) {
      event.preventDefault();
      open(current);
    } else if (event.key === 'Escape') {
      // Here and not only on the dialog's `cancel`: a search field clears itself on the first
      // Escape in some browsers, and jsdom has no `cancel`.
      event.preventDefault();
      onClose();
    }
  };

  // A click on the dialog element itself is a click on its backdrop.
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const waiting = searching && (term !== q.trim() || results.isFetching) && !results.data;
  const error = searching && results.isError;
  const empty =
    searching &&
    !waiting &&
    !error &&
    results.data &&
    flat.length === 0 &&
    !messages.isFetching &&
    !sections.some((s) => s.note);

  // The panel scales in from 641 px; the phone's full-screen sheet only fades, since a scale
  // would show its edges growing (and it is the whole screen from the first frame).
  return (
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-label={t('search.title')}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={onClick}
      className="m-0 animate-fade-in overflow-hidden min-[641px]:animate-menu-in bg-card p-0 text-foreground backdrop:animate-fade-in backdrop:bg-foreground/30 max-[640px]:fixed max-[640px]:inset-0 max-[640px]:h-dvh max-[640px]:max-h-none max-[640px]:w-full max-[640px]:max-w-none min-[641px]:fixed min-[641px]:inset-x-0 min-[641px]:top-[12vh] min-[641px]:mx-auto min-[641px]:max-h-[70vh] min-[641px]:w-[min(640px,calc(100vw-32px))] min-[641px]:rounded-xl min-[641px]:shadow-lift"
    >
      <div className="flex h-full max-h-[inherit] flex-col max-[640px]:pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 border-b-2 border-border px-4 py-2">
          <span className="text-muted-foreground">
            <SearchGlyph />
          </span>
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current ? optionId(listId, current.key) : undefined}
            aria-label={t('search.title')}
            placeholder={t('search.placeholder')}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={100}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-12 min-w-0 flex-1 bg-transparent text-button font-medium placeholder:text-muted-foreground focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="button"
            onClick={onClose}
            className="h-11 shrink-0 rounded-full px-3 text-tiny font-semibold hover:bg-accent min-[641px]:hidden"
          >
            {t('search.cancel')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" aria-busy={waiting}>
          <ul id={listId} role="listbox" aria-label={t('search.title')} className="contents">
            {sections.map((section) => (
              <li key={section.key} role="presentation" className="mb-1 last:mb-0">
                <div
                  id={`${listId}-${section.key}`}
                  className="px-3 pt-2 pb-1 text-micro font-semibold text-muted-foreground"
                >
                  {t(`search.sections.${section.key}`)}
                </div>
                {section.note && (
                  <p className="px-3 pb-2 text-micro text-muted-foreground">{section.note}</p>
                )}
                <ul role="group" aria-labelledby={`${listId}-${section.key}`}>
                  {section.items.map((item) => (
                    <Row
                      key={item.key}
                      id={optionId(listId, item.key)}
                      item={item}
                      selected={item.key === current?.key}
                      onPick={() => open(item)}
                      onPoint={() => select(flat.indexOf(item))}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p role="status" className="px-3 py-3 text-tiny text-muted-foreground empty:hidden">
            {waiting
              ? t('search.loading')
              : error
                ? t(
                    results.error instanceof ApiError && results.error.status === 429
                      ? 'search.rateLimited'
                      : 'search.error',
                  )
                : empty
                  ? t('search.empty', { q: q.trim() })
                  : !searching && q.trim().length > 0
                    ? t('search.tooShort')
                    : ''}
          </p>
        </div>
        <div
          aria-hidden="true"
          className="flex gap-4 border-t-2 border-border px-4 py-2 text-micro text-muted-foreground max-[640px]:hidden"
        >
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> {t('search.keys.move')}
          </span>
          <span>
            <Kbd>Enter</Kbd> {t('search.keys.open')}
          </span>
          <span>
            <Kbd>Esc</Kbd> {t('search.keys.close')}
          </span>
        </div>
      </div>
    </dialog>
  );
}

const optionId = (listId: string, key: string) =>
  `${listId}-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;

function Row({
  id,
  item,
  selected,
  onPick,
  onPoint,
}: {
  id: string;
  item: PaletteItem;
  selected: boolean;
  onPick: () => void;
  onPoint: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      onClick={onPick}
      onPointerMove={selected ? undefined : onPoint}
      className="group flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 aria-selected:bg-secondary"
    >
      <span className="text-muted-foreground">
        <KindIcon kind={item.kind} />
      </span>
      <span className="min-w-0 flex-1">
        {item.highlights ? (
          // A message's snippet: body text, its matches semibold on the pill colour.
          <span className="block truncate text-tiny">
            <Highlighted text={item.label} highlights={item.highlights} />
          </span>
        ) : (
          <span
            className={`block truncate text-tiny font-semibold ${item.closed ? 'text-muted-foreground' : ''}`}
          >
            {item.label}
          </span>
        )}
        {item.detail && (
          <span className="block truncate text-micro text-muted-foreground">{item.detail}</span>
        )}
      </span>
      {item.closed && (
        <span className="sr-only">
          {t(item.kind === 'ticket' ? 'search.resolved' : 'search.done')}
        </span>
      )}
      {item.badge && (
        <span className="shrink-0 rounded-sm bg-secondary px-1.5 text-micro font-semibold tabular-nums">
          {item.badge}
        </span>
      )}
    </li>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-sm border border-border px-1 font-sans text-micro font-semibold">
      {children}
    </kbd>
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="block shrink-0"
    >
      {children}
    </svg>
  );
}

function SearchGlyph() {
  return (
    <Glyph>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Glyph>
  );
}

/** A 16 px outline glyph per kind of row (the design rule for typed menus). */
function KindIcon({ kind }: { kind: PaletteKind }) {
  switch (kind) {
    case 'group':
      return (
        <Glyph>
          <path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6" />
        </Glyph>
      );
    case 'ticket':
      return (
        <Glyph>
          <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" />
        </Glyph>
      );
    case 'task':
      return (
        <Glyph>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="m9 12 2 2 4-4" />
        </Glyph>
      );
    case 'knowledge':
      return (
        <Glyph>
          <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" />
        </Glyph>
      );
    case 'project':
      return (
        <Glyph>
          <path d="M3 7h7l2 2h9v10H3z" />
        </Glyph>
      );
    case 'event':
      return (
        <Glyph>
          <rect x="4" y="5" width="16" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M4 10h16" />
        </Glyph>
      );
    case 'person':
      return (
        <Glyph>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </Glyph>
      );
    case 'message':
      return (
        <Glyph>
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </Glyph>
      );
    case 'more':
      return (
        <Glyph>
          <path d="m6 9 6 6 6-6" />
        </Glyph>
      );
    default:
      return (
        <Glyph>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </Glyph>
      );
  }
}
