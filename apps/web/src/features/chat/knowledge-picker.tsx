import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MESSAGE_MAX_KNOWLEDGE, type MessageKnowledge } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PanelHeader } from '@/components/ui/panel-header';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
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
 * at most `MESSAGE_MAX_KNOWLEDGE` per message, counting the ones already picked.
 */
export default function KnowledgePicker({
  groupId,
  picked,
  onDone,
  onClose,
}: {
  groupId: string;
  picked: PickedKnowledge[];
  onDone: (items: PickedKnowledge[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<PickedKnowledge[]>(picked);
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const query = useInfiniteQuery(
    groupKnowledgeQuery(groupId, { q: q || undefined, shareable: true }),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const full = chosen.length >= MESSAGE_MAX_KNOWLEDGE;
  const isChosen = (id: string) => chosen.some((c) => c.id === id);
  const toggle = (item: (typeof items)[number]) =>
    setChosen((list) =>
      list.some((c) => c.id === item.id)
        ? list.filter((c) => c.id !== item.id)
        : list.length >= MESSAGE_MAX_KNOWLEDGE
          ? list
          : [
              ...list,
              {
                id: item.id,
                available: true,
                type: item.type,
                title: item.title,
                folderPath: item.folderPath.map((f) => f.name),
              },
            ],
    );

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
        <p className="text-micro text-muted-foreground">{t('chat.knowledge.pickerHint')}</p>
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
        {full && (
          <p className="text-micro text-muted-foreground">
            {t('chat.knowledge.limit', { count: MESSAGE_MAX_KNOWLEDGE })}
          </p>
        )}
      </div>
    </SheetDialog>
  );
}
