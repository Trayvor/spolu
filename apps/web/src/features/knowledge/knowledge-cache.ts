import type { InfiniteData } from '@tanstack/react-query';
import type { KnowledgePage, KnowledgeSummary } from '@spolu/shared';

type Data = InfiniteData<KnowledgePage>;

/**
 * A known item is replaced where it is. An unknown one goes where the server lists it (newest
 * `createdAt` first): first when it is the newest, before the first older loaded row, or last when
 * every page is loaded. An item older than every loaded row while more pages exist is left out:
 * "Load more" brings it, so it is never listed twice.
 */
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
  const newest = first.items[0];
  if (!newest || item.createdAt >= newest.createdAt) {
    return { ...data, pages: [{ ...first, items: [item, ...first.items] }, ...rest] };
  }
  const pages = data.pages.map((page) => ({ ...page, items: [...page.items] }));
  for (const page of pages) {
    const at = page.items.findIndex((i) => i.createdAt < item.createdAt);
    if (at >= 0) {
      page.items.splice(at, 0, item);
      return {
        ...data,
        pages: pages.map((p, n) =>
          p.items.length === data.pages[n]!.items.length ? data.pages[n]! : p,
        ),
      };
    }
  }
  const last = pages[pages.length - 1]!;
  if (last.nextCursor !== null) return data;
  last.items.push(item);
  return { ...data, pages: pages.map((p, n) => (n === pages.length - 1 ? p : data.pages[n]!)) };
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
