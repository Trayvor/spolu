import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { KnowledgePage } from '@spolu/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { KnowledgeRow } from './knowledge-row';

/** The rows of a query in one Card, separated by borders, then "Load more". */
export function KnowledgeList({
  query,
  onOpen,
  showGroup,
  empty,
}: {
  query: UseInfiniteQueryResult<InfiniteData<KnowledgePage>>;
  onOpen: (id: string) => void;
  showGroup?: boolean;
  empty: ReactNode;
}) {
  const { t } = useTranslation();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  if (items.length === 0) return <>{empty}</>;
  return (
    <div className="flex flex-col items-center gap-4">
      <Card className="w-full gap-0 divide-y divide-border overflow-hidden py-0">
        {items.map((item) => (
          <KnowledgeRow key={item.id} item={item} onOpen={onOpen} showGroup={showGroup} />
        ))}
      </Card>
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
