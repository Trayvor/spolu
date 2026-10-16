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
  showPath,
  empty,
}: {
  query: UseInfiniteQueryResult<InfiniteData<KnowledgePage>>;
  onOpen: (id: string) => void;
  showGroup?: boolean;
  /** Search results: each row shows its folder path. */
  showPath?: boolean;
  empty: ReactNode;
}) {
  const { t } = useTranslation();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  if (query.isPending) {
    return (
      <Card
        role="status"
        aria-busy="true"
        className="h-24 w-full animate-pulse bg-muted"
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
