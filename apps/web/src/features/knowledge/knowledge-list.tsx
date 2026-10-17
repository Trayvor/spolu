import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { KnowledgePage } from '@spolu/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { KnowledgeCard } from './knowledge-card';
import { KnowledgeRow } from './knowledge-row';
import type { KnowledgeView } from './view-toggle';

/**
 * The items of a query, then "Load more": rows in one Card, separated by borders, or (`view`
 * "cards") a grid of cards, one column on phones and up to three as the space allows.
 */
export function KnowledgeList({
  query,
  onOpen,
  showGroup,
  showPath,
  empty,
  view = 'list',
}: {
  query: UseInfiniteQueryResult<InfiniteData<KnowledgePage>>;
  onOpen: (id: string) => void;
  showGroup?: boolean;
  /** Search results: each row shows its folder path. */
  showPath?: boolean;
  empty: ReactNode;
  view?: KnowledgeView;
}) {
  const { t } = useTranslation();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  if (query.isPending) {
    return (
      <Card
        role="status"
        aria-busy="true"
        className="h-24 w-full animate-skeleton bg-muted"
        aria-label={t('knowledge.list.loading')}
      />
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-button text-muted-foreground">
        {t('knowledge.list.error')}
      </p>
    );
  }
  if (items.length === 0) return <>{empty}</>;
  return (
    <div className="flex flex-col items-center gap-4">
      {view === 'cards' ? (
        <div className="@container w-full">
          <ul className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
            {items.map((item) => (
              <li key={item.id} className="min-w-0">
                <KnowledgeCard
                  item={item}
                  onOpen={onOpen}
                  showGroup={showGroup}
                  showPath={showPath}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Card className="w-full gap-0 divide-y divide-border overflow-hidden py-0">
          {items.map((item) => (
            <KnowledgeRow
              key={item.id}
              item={item}
              onOpen={onOpen}
              showGroup={showGroup}
              showPath={showPath}
            />
          ))}
        </Card>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? t('knowledge.list.loading') : t('knowledge.list.loadMore')}
        </Button>
      )}
    </div>
  );
}
