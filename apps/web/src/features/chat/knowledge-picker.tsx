import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MESSAGE_MAX_KNOWLEDGE, type MessageKnowledge } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PanelHeader } from '@/components/ui/panel-header';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { groupQuery } from '@/features/groups/api';
import { AdminGroupBadge } from '@/features/knowledge/admin-group-badge';
import { groupKnowledgeQuery } from '@/features/knowledge/api';
import { NoteIcon, SmallFolderIcon } from '@/features/knowledge/icons';
import { cn } from '@/lib/utils';
import { KNOWLEDGE_ICONS } from './knowledge-cards';

export type PickedKnowledge = Extract<MessageKnowledge, { available: true }>;

/** How long the search waits after the last key. */
const SEARCH_DELAY_MS = 250;

/**
 * Phase 28: choose knowledge items of the group to attach to a message (a lazy chunk). It lists
 * only items everyone in the group may read (`?shareable=1`), newest first, with the tab's search;
 * at most `MESSAGE_MAX_KNOWLEDGE` per message, counting the ones already picked. The same list is
 * the Knowledge tab of the attachment picker (Phase 34).
 */
export default function KnowledgePicker({
  groupId,
  picked,
  max = MESSAGE_MAX_KNOWLEDGE,
  limitKey = 'chat.knowledge.limit',
  onDone,
  onClose,
}: {
  groupId: string;
  picked: PickedKnowledge[];
  /** How many items one pick may hold; the caller subtracts the links it keeps elsewhere. */
  max?: number;
  /** The note shown at the limit; the description editor has its own wording. */
  limitKey?: 'chat.knowledge.limit' | 'chat.knowledge.limitDescription';
  onDone: (items: PickedKnowledge[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [chosen, setChosen] = useState<PickedKnowledge[]>(picked);

  return (
    <SheetDialog onEscape={onClose} initialFocus={titleRef} testId="knowledge-picker">
      <PanelHeader onClose={onClose} compactBelow={641} backLabel={t('chat.knowledge.back')}>
        <Button size="sm" className="ml-auto" onClick={() => onDone(chosen)}>
          {t('chat.knowledge.attachCount', { count: chosen.length })}
        </Button>
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:py-5">
        <SheetDialogTitle
          ref={titleRef}
          tabIndex={-1}
          className="text-medium font-semibold outline-none"
        >
          {t('chat.knowledge.pickerTitle')}
        </SheetDialogTitle>
        <KnowledgePickList
          groupId={groupId}
          chosen={chosen}
          setChosen={setChosen}
          max={max}
          limitKey={limitKey}
        />
      </div>
    </SheetDialog>
  );
}

/** The picker's body: hint, search, the checkbox list and the limit note. */
export function KnowledgePickList({
  groupId,
  chosen,
  setChosen,
  max = MESSAGE_MAX_KNOWLEDGE,
  limitKey = 'chat.knowledge.limit',
}: {
  groupId: string;
  chosen: PickedKnowledge[];
  max?: number;
  /** The note shown at the limit; the description editor has its own wording. */
  limitKey?: 'chat.knowledge.limit' | 'chat.knowledge.limitDescription';
  setChosen: (update: (list: PickedKnowledge[]) => PickedKnowledge[]) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  // Phase 34: an admin in a client group also picks from "eGrant tím" (its shareable items).
  const admin = isAdmin(useSession());
  const group = useQuery({ ...groupQuery(groupId), enabled: admin }).data;
  const canSwitch = admin && group !== undefined && group.kind !== 'admin';
  const [source, setSource] = useState<'group' | 'admin_group'>('group');
  const fromAdminGroup = canSwitch && source === 'admin_group';
  const query = useInfiniteQuery(
    groupKnowledgeQuery(groupId, {
      q: q || undefined,
      shareable: true,
      ...(fromAdminGroup ? { source: 'admin_group' as const } : {}),
    }),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const full = chosen.length >= max;
  const isChosen = (id: string) => chosen.some((c) => c.id === id);
  const toggle = (item: (typeof items)[number]) =>
    setChosen((list) =>
      list.some((c) => c.id === item.id)
        ? list.filter((c) => c.id !== item.id)
        : list.length >= max
          ? list
          : [
              ...list,
              {
                id: item.id,
                available: true,
                type: item.type,
                title: item.title,
                // As the server's card: an admin-group item shows its badge and no folders.
                ...(item.source === 'admin_group' && item.groupId !== groupId
                  ? { folderPath: [], source: 'admin_group' as const }
                  : { folderPath: item.folderPath.map((f) => f.name) }),
              },
            ],
    );

  return (
    <>
      {canSwitch && (
        <SourceSwitch
          value={source}
          onChange={setSource}
          labels={{
            group: t('chat.knowledge.sourceGroup'),
            admin_group: t('chat.knowledge.adminGroup'),
          }}
          label={t('chat.knowledge.source')}
        />
      )}
      <p className="text-micro text-muted-foreground">
        {fromAdminGroup ? t('chat.knowledge.adminGroupHint') : t('chat.knowledge.pickerHint')}
      </p>
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('chat.knowledge.search')}
        aria-label={t('chat.knowledge.search')}
      />
      <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto" aria-busy={query.isPending}>
        {items.map((item) => {
          const on = isChosen(item.id);
          const Glyph = KNOWLEDGE_ICONS[item.type] ?? NoteIcon;
          return (
            <li key={item.id}>
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent',
                  !on && full && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && full}
                  onChange={() => toggle(item)}
                  className="size-4 shrink-0 accent-brand-purple"
                />
                <span aria-hidden="true" className="shrink-0 text-brand-purple">
                  <Glyph />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-button font-semibold">{item.title}</span>
                  {fromAdminGroup && (
                    <AdminGroupBadge
                      label={t('chat.knowledge.adminGroup')}
                      className="my-0.5 self-start"
                    />
                  )}
                  <span className="flex min-w-0 items-center gap-1 text-micro text-muted-foreground">
                    {t(`chat.knowledge.types.${item.type}`)}
                    {item.folderPath.length > 0 && (
                      <>
                        <SmallFolderIcon />
                        <span className="truncate">
                          {item.folderPath.map((f) => f.name).join(' / ')}
                        </span>
                      </>
                    )}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
        {query.isSuccess && items.length === 0 && (
          <li className="px-2 py-4 text-body text-muted-foreground">
            {q ? t('chat.knowledge.noResults') : t('chat.knowledge.empty')}
          </li>
        )}
        {query.isError && (
          <li role="alert" className="px-2 py-4 text-body text-error-ink">
            {t('errors.generic')}
          </li>
        )}
        {query.hasNextPage && (
          <li className="px-2 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('chat.knowledge.loadMore')}
            </Button>
          </li>
        )}
      </ul>
      {full && <p className="text-micro text-muted-foreground">{t(limitKey, { count: max })}</p>}
    </>
  );
}

type Source = 'group' | 'admin_group';
const SOURCES: readonly Source[] = ['group', 'admin_group'];

/**
 * Phase 34: where the picker lists from, for an admin in a client group: "This client" or
 * "eGrant tím". Two pills in a track like "Visible to"; arrows move the choice.
 */
function SourceSwitch({
  value,
  onChange,
  labels,
  label,
}: {
  value: Source;
  onChange: (next: Source) => void;
  labels: Record<Source, string>;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (SOURCES.indexOf(value) + step + SOURCES.length) % SOURCES.length;
    onChange(SOURCES[next]!);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex max-w-full shrink-0 self-start rounded-full bg-secondary p-1"
    >
      {SOURCES.map((option, i) => {
        const checked = option === value;
        return (
          <button
            key={option}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option)}
            className={cn(
              'h-8 min-w-0 truncate rounded-full px-4 text-tiny font-semibold transition-colors duration-(--duration-fast)',
              checked ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-surface-3',
            )}
          >
            {labels[option]}
          </button>
        );
      })}
    </div>
  );
}
