import { useCallback } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';

/** The chat's own search params: the open thread and the message to show. */
type ChatSearch = { thread?: string; message?: string };

const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * `?thread=<rootId>` and `?message=<id>` of the current route, so an open thread survives a
 * reload and a message can be linked. The route declares no search schema; other params are kept.
 */
export function useChatSearch() {
  const search = useLocation({ select: (l) => l.search as Record<string, unknown> });
  const navigate = useNavigate();

  const update = useCallback(
    (patch: ChatSearch, replace: boolean) => {
      void navigate({
        to: '.',
        replace,
        search: ((prev: Record<string, unknown>) => {
          const next = { ...prev, ...patch };
          for (const key of Object.keys(patch) as (keyof ChatSearch)[]) {
            if (next[key] === undefined) delete next[key];
          }
          return next;
        }) as never,
      });
    },
    [navigate],
  );

  /** Opening or closing a thread is a history step, so Back closes it again. */
  const setThread = useCallback((id?: string) => update({ thread: id }, false), [update]);
  /** After the message was shown; replaces the entry so Back does not show it again. */
  const clearMessage = useCallback(() => update({ message: undefined }, true), [update]);

  return {
    thread: text(search.thread),
    message: text(search.message),
    setThread,
    clearMessage,
  };
}
