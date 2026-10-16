import type { InfiniteData } from '@tanstack/react-query';
import type { KnowledgePage, KnowledgeSummary } from '@spolu/shared';

type Data = InfiniteData<KnowledgePage>;

/** A known item is replaced where it is; a new one goes first on the first page. */
export function upsertSummary(data: Data, item: KnowledgeSummary): Data {
  const known = data.pages.some((page) => page.items.some((i) => i.id === item.id));
  if (known) {
    return {
      ...data,
      pages: data.pages.map((page) =>
        page.items.some((i) => i.id === item.id)
          ? { ...page, items: page.items.map((i) => (i.id === item.id ? item : i)) }
          : page,
      ),
    };
  }
  const [first, ...rest] = data.pages;
  if (!first)
    return { ...data, pages: [{ items: [item], nextCursor: null }], pageParams: [undefined] };
  return { ...data, pages: [{ ...first, items: [item, ...first.items] }, ...rest] };
}

/** The data without the item; the same object when the item is not in it. */
export function removeSummary(data: Data, id: string): Data {
  if (!data.pages.some((page) => page.items.some((i) => i.id === id))) return data;
  return {
    ...data,
    pages: data.pages.map((page) =>
      page.items.some((i) => i.id === id)
        ? { ...page, items: page.items.filter((i) => i.id !== id) }
        : page,
    ),
  };
}
