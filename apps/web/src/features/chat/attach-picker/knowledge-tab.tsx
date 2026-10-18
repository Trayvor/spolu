import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MESSAGE_MAX_KNOWLEDGE } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { globalKnowledgeQuery } from '@/features/knowledge/api';
import { NoteIcon, SmallFolderIcon } from '@/features/knowledge/icons';
import { ClientTag } from '../client-tag';
import { KNOWLEDGE_ICONS } from '../knowledge-cards';
import type { PickedKnowledge } from '../knowledge-picker';
import { ClientBar, type CrossClient } from './client-bar';
import { PickRow } from './pick-row';
import { toggled, useSearchText } from './picked';

/**
 * The Knowledge tab in the admin group (Phase 34 part D, decision 12): every client's items
 * through the global knowledge list, admins-only ones too (marked "Only eGrant": only admins read
 * the admin group), under the client filter, each row naming its client. The client groups keep
 * the Phase 28 list (`KnowledgePickList`).
 */
export function CrossClientKnowledgeTab({
  cross,
  chosen,
  setChosen,
}: {
  cross: CrossClient;
  chosen: PickedKnowledge[];
  setChosen: (update: (list: PickedKnowledge[]) => PickedKnowledge[]) => void;
}) {
  const { t } = useTranslation();
  const { text, setText, q } = useSearchText();
  const noClients = cross.clients?.length === 0;
  const search = q.length >= 2 ? q : '';
  const query = useInfiniteQuery({
    ...globalKnowledgeQuery({
      ...(search ? { q: search } : {}),
      ...(cross.clients ? { clients: cross.clients } : { scope: 'all' as const }),
    }),
    enabled: !noClients,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const full = chosen.length >= MESSAGE_MAX_KNOWLEDGE;
  return (
    <>
      <ClientBar cross={cross} />
      <p className="text-micro text-muted-foreground">{t('chat.attach.clients.knowledgeHint')}</p>
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('chat.knowledge.search')}
        aria-label={t('chat.knowledge.search')}
      />
      <ul
        role="list"
        className="-mx-2 min-h-0 flex-1 overflow-y-auto"
        aria-busy={query.isPending && !noClients}
      >
        {items.map((item) => {
          const on = chosen.some((c) => c.id === item.id);
          const Glyph = KNOWLEDGE_ICONS[item.type] ?? NoteIcon;
          const card: PickedKnowledge = {
            id: item.id,
            available: true,
            type: item.type,
            title: item.title,
            folderPath: item.folderPath.map((f) => f.name),
          };
          return (
            <PickRow
              key={item.id}
              checked={on}
              disabled={!on && full}
              onChange={() => setChosen((list) => toggled(list, card, MESSAGE_MAX_KNOWLEDGE))}
            >
              <span aria-hidden="true" className="shrink-0 text-brand-purple-ink">
                <Glyph />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-button font-semibold">{item.title}</span>
                <span className="flex min-w-0 items-center gap-1 text-micro text-muted-foreground">
                  {t(`chat.knowledge.types.${item.type}`)}
                  {item.visibility === 'admins' && (
                    <span className="font-semibold text-foreground">
                      {t('chat.attach.clients.onlyEgrant')}
                    </span>
                  )}
                  {item.folderPath.length > 0 && (
                    <>
                      <SmallFolderIcon />
                      <span className="truncate">
                        {item.folderPath.map((f) => f.name).join(' / ')}
                      </span>
                    </>
                  )}
                </span>
                <ClientTag groupId={item.groupId} directory={cross.directory} />
              </span>
            </PickRow>
          );
        })}
        {(query.isSuccess || noClients) && items.length === 0 && (
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
    </>
  );
}
