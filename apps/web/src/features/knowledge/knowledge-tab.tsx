import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useParams, useSearch } from '@tanstack/react-router';
import { KnowledgeTypes, type KnowledgeType } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUpdateSearch } from '@/lib/use-update-search';
import { cn } from '@/lib/utils';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { groupKnowledgeQuery } from './api';
import { KnowledgeDialog, type KnowledgeDialogTarget } from './knowledge-dialog';
import { KnowledgeList } from './knowledge-list';
import { NewItemMenu } from './new-item-menu';
import { useKnowledgeEvents } from './use-knowledge-events';

/** The tab's URL search: the list filter, and the open item (`k`, "new" with `kind` to create). */
type KnowledgeTabSearch = {
  type?: KnowledgeType;
  q?: string;
  k?: string;
  kind?: KnowledgeType;
};

/** A search runs from this many characters, after this many ms without typing. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

const pill = 'inline-flex h-8 items-center rounded-full px-4 text-tiny font-semibold';

const PLURAL: Record<KnowledgeType, string> = {
  note: 'notes',
  file: 'files',
  link: 'links',
  reminder: 'reminders',
};

export function KnowledgeTab() {
  const { groupId } = useParams({ strict: false });
  return groupId ? <GroupKnowledge groupId={groupId} /> : null;
}

/** The group's knowledge: header, type pills, search, the list, and the dialog from `?k`. */
function GroupKnowledge({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  // The route's `validateSearch` (router.tsx) has checked these.
  const { type, q, k, kind }: KnowledgeTabSearch = useSearch({ strict: false });
  const updateSearch = useUpdateSearch();
  const canSeeAdmins = isAdmin(useSession());
  const filter = { type, q };
  const query = useInfiniteQuery(groupKnowledgeQuery(groupId, filter));
  const [notice, setNotice] = useState(false);

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

  const setType = (next: KnowledgeType | undefined) =>
    updateSearch(
      (s) => {
        if (next) s.type = next;
        else delete s.type;
      },
      { replace: false },
    );
  const clearFilters = () => {
    written.current = undefined;
    setText('');
    updateSearch(
      (s) => {
        delete s.type;
        delete s.q;
      },
      { replace: false },
    );
  };
  const open = (id: string) => {
    setNotice(false);
    updateSearch(
      (s) => {
        s.k = id;
        delete s.kind;
      },
      { replace: false },
    );
  };
  const create = (pick: KnowledgeType) => {
    setNotice(false);
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
    setNotice(true);
    close();
  }, [close]);

  const target: KnowledgeDialogTarget | null =
    k === 'new'
      ? kind
        ? { mode: 'create', type: kind, groupId }
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

  const filtered = Boolean(type || q);
  const empty = filtered ? (
    <div className="flex flex-col items-start gap-3 py-6">
      <p className="text-button text-muted-foreground">
        {q ? t('knowledge.tab.noMatch', { q }) : t('knowledge.tab.noMatchType')}
      </p>
      <Button variant="ghost" size="sm" onClick={clearFilters}>
        {t('knowledge.tab.clearFilters')}
      </Button>
    </div>
  ) : (
    <div className="flex flex-col items-start gap-3 py-6">
      <p className="max-w-prose text-button text-muted-foreground">{t('knowledge.tab.empty')}</p>
      <NewItemMenu onPick={create} />
    </div>
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between">
        <h2 className="text-medium font-semibold">{t('knowledge.tab.title')}</h2>
        <NewItemMenu onPick={create} className="w-full min-[641px]:w-auto" />
      </div>
      <div className="flex flex-col gap-3 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between">
        <div role="group" aria-label={t('knowledge.tab.filters')} className="flex flex-wrap gap-2">
          {[undefined, ...KnowledgeTypes].map((option) => {
            const current = option === type;
            return (
              <button
                key={option ?? 'all'}
                type="button"
                aria-pressed={current}
                onClick={() => setType(option)}
                className={cn(
                  pill,
                  current
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-surface-3',
                )}
              >
                {t(`knowledge.types.${option ? PLURAL[option] : 'all'}`)}
              </button>
            );
          })}
        </div>
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('knowledge.tab.search')}
          aria-label={t('knowledge.tab.search')}
          className="min-[641px]:w-72"
        />
      </div>
      {notice && (
        <p role="status" className="rounded-lg bg-secondary p-3 text-button font-semibold">
          {t('knowledge.detail.unavailable')}
        </p>
      )}
      <KnowledgeList query={query} onOpen={open} empty={empty} />
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
