import { useCallback } from 'react';
import { useLocation, useRouter } from '@tanstack/react-router';
import { backOr, samePath } from '@/lib/back';
import { useUpdateSearch } from '@/lib/use-update-search';

/** The chat's own search params: the open thread, the message to show and their channel. */
type ChatSearch = { thread?: string; message?: string; c?: string };

const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * `?thread=<rootId>` and `?message=<id>` of the current route, scoped to one chat by
 * `&c=<channelId>`, so an open thread survives a reload, a message can be linked, and two chats
 * on one page (a group chat and a task chat) never react to each other's params. `thread` and
 * `message` are only returned when `c` is `channelId`; `c` goes away with the last of them.
 *
 * Links without `c` (older links) are `unscoped`: the screen that owns them (the group's Chat
 * tab) claims them with `adopt()` before it renders its conversation. The route declares no
 * search schema; other params are kept.
 */
export function useChatSearch(channelId: string | undefined) {
  const search = useLocation({ select: (l) => l.search as Record<string, unknown> });
  const updateSearch = useUpdateSearch();
  const channel = text(search.c);
  const mine = channelId !== undefined && channel === channelId;

  const update = useCallback(
    (change: (next: Record<string, unknown>) => void, replace: boolean) =>
      updateSearch(
        (next) => {
          change(next);
          if (next.thread === undefined && next.message === undefined) delete next.c;
        },
        { replace },
      ),
    [updateSearch],
  );

  const router = useRouter();
  /**
   * Opening a thread is a history step, so Back closes it again. Closing it goes back to that
   * step when it is this same screen (so Back does not reopen it), else drops the param in place.
   */
  const setThread = useCallback(
    (id?: string) => {
      const apply = (replace: boolean) =>
        update((next) => {
          if (next.c !== channelId) {
            // The params of another chat give way.
            delete next.thread;
            delete next.message;
          }
          if (id === undefined) delete next.thread;
          else Object.assign(next, { thread: id, c: channelId } satisfies ChatSearch);
        }, replace);
      if (id !== undefined) apply(false);
      else backOr(router, () => apply(true), samePath(router, ['thread']));
    },
    [update, channelId, router],
  );

  /** After the message was shown; replaces the entry so Back does not show it again. */
  const clearMessage = useCallback(
    () =>
      update((next) => {
        if (next.c === channelId) delete next.message;
      }, true),
    [update, channelId],
  );

  /** Claims params without a channel for this chat (replaces the history entry). */
  const adopt = useCallback(
    () =>
      update((next) => {
        if (next.c === undefined) next.c = channelId;
      }, true),
    [update, channelId],
  );

  return {
    thread: mine ? text(search.thread) : undefined,
    message: mine ? text(search.message) : undefined,
    /** A thread or message param without `c`. */
    unscoped: channel === undefined && (text(search.thread) ?? text(search.message)) !== undefined,
    setThread,
    clearMessage,
    adopt,
  };
}
