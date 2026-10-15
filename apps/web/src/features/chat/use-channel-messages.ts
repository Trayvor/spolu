import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChatEvents,
  type ChatMessageEvent,
  type MessageDto,
  type SendMessageInput,
} from '@spolu/shared';
import { useGroupRoomJoins } from '@/features/groups/use-group-room';
import { getSocket } from '@/lib/socket';
import {
  fetchAround,
  fetchChanges,
  fetchPage,
  groupChatQuery,
  markRead as postRead,
  messageCursor,
  sendMessage,
  threadQuery,
} from './api';
import {
  initialWindow,
  upsertIntoThread,
  windowReducer,
  type WindowAction,
} from './channel-window';

/** What a composer hands over; the hook adds the `clientId`. */
export type SendInput = Omit<SendMessageInput, 'clientId'>;

/**
 * The message window of one channel: the first page (the newest, or the one around
 * `aroundMessageId`), older and newer pages on demand, live `chat:message` events, catch-up after
 * every rejoin of the group room, and optimistic sending.
 *
 * Every message that reaches the client (event, catch-up, POST answer) goes through one `apply`,
 * which also patches cached threads, so an open thread panel stays current. Catch-up runs when
 * `useGroupRoomJoins()` grows while the window is loaded (never on a raw socket `connect`, which
 * comes before the room is joined), so it must be rendered under a `GroupRoomProvider`.
 *
 * `error` is the error of the last first-page (or around) load; a failed older/newer page or catch-up is simply asked for
 * again by the next scroll or rejoin. Clearing `aroundMessageId` keeps the window where it is.
 */
export function useChannelMessages(
  channelId: string,
  opts: { groupId: string; aroundMessageId?: string },
) {
  const { groupId, aroundMessageId } = opts;
  const queryClient = useQueryClient();
  const joins = useGroupRoomJoins();
  const [window, dispatch] = useReducer(windowReducer, initialWindow);
  // Tagged with the channel, so a switch never shows the previous chat's error.
  const [failure, setFailure] = useState<{ channelId: string; error: unknown } | null>(null);
  const setError = useCallback(
    (error: unknown) => setFailure(error === null ? null : { channelId, error }),
    [channelId],
  );
  const error = failure?.channelId === channelId ? failure.error : null;

  // Mirrors for async callbacks. `lastSeqRef` follows `window.lastSeq` synchronously, so a page
  // that raced a live event can be told apart (see `afterPage`).
  const windowRef = useRef(window);
  const joinsRef = useRef(joins);
  const lastSeqRef = useRef(0);
  /** The channel the window holds; null until the first load starts and after unmount. */
  const channelRef = useRef<string | null>(null);
  /** Bumped by every window reset or reload; answers of older requests are dropped. */
  const genRef = useRef(0);
  /** The join counter the window is current with. */
  const handledJoinsRef = useRef(0);
  const catchUpChain = useRef<Promise<void>>(Promise.resolve());
  const busy = useRef({ older: false, newer: false });

  useEffect(() => {
    windowRef.current = window;
    joinsRef.current = joins;
  });

  const apply = useCallback(
    (incoming: MessageDto[]) => {
      // An answer that arrives after a channel switch belongs to the old channel.
      const messages = incoming.filter((m) => m.channelId === channelRef.current);
      if (messages.length === 0) return;
      dispatch({ type: 'upsert', messages });
      const readUpTo = windowRef.current.lastReadAt;
      let unreadDeleted = false;
      for (const m of messages) {
        lastSeqRef.current = Math.max(lastSeqRef.current, m.changeSeq);
        const { queryKey } = threadQuery(m.parentId ?? m.id);
        const thread = queryClient.getQueryData(queryKey);
        if (thread) queryClient.setQueryData(queryKey, upsertIntoThread(thread, m));
        if (m.parentId === null && m.deletedAt !== null) {
          unreadDeleted ||= readUpTo === null || m.createdAt > readUpTo;
        }
      }
      // The unread count would stay too high (the badge only counts up from events).
      if (unreadDeleted) {
        void queryClient.invalidateQueries({ queryKey: groupChatQuery(groupId).queryKey });
      }
    },
    [queryClient, groupId],
  );

  /**
   * Records the seq of a page that just arrived. True when a live event newer than the page came
   * in meanwhile: the page may then hold an older version of a row (its event was ignored or
   * overwritten), so everything after the page's seq has to be asked for again.
   */
  const pageIsBehind = (pageSeq: number): boolean => {
    if (lastSeqRef.current > pageSeq) return true;
    lastSeqRef.current = pageSeq;
    return false;
  };

  /** Replaces the window with the newest page. Its seq, or null when the answer came too late. */
  const loadLatest = useCallback(async (): Promise<number | null> => {
    const gen = genRef.current;
    const page = await fetchPage(channelId);
    if (gen !== genRef.current) return null;
    dispatch({ type: 'loadedLatest', page });
    setError(null);
    // Replies changed in a skipped range never reached the cached threads.
    void queryClient.invalidateQueries({ queryKey: ['chat', 'thread'] });
    return page.lastSeq;
  }, [channelId, queryClient, setError]);

  /** Applies what changed after `afterSeq` (default: the window's seq). Runs one at a time. */
  const catchUp = useCallback(
    (afterSeq?: number): Promise<void> => {
      const run = async (from: number): Promise<void> => {
        const gen = genRef.current;
        const changes = await fetchChanges(channelId, from);
        if (gen !== genRef.current) return;
        apply(changes.messages);
        if (!changes.truncated) return;
        // More than one catch-up answer missed: the newest page is cheaper than paging through.
        const pageSeq = await loadLatest();
        if (pageSeq !== null && pageIsBehind(pageSeq)) await run(pageSeq);
      };
      catchUpChain.current = catchUpChain.current
        .then(() => run(afterSeq ?? lastSeqRef.current))
        .catch(() => undefined);
      return catchUpChain.current;
    },
    [channelId, apply, loadLatest],
  );

  const afterPage = useCallback(
    (pageSeq: number) => {
      if (pageIsBehind(pageSeq)) void catchUp(pageSeq);
    },
    [catchUp],
  );

  // First page; again when the channel changes or a new message is to be shown.
  useEffect(() => {
    if (aroundMessageId === undefined && channelRef.current === channelId) return;
    const gen = ++genRef.current;
    if (channelRef.current !== channelId) {
      channelRef.current = channelId;
      lastSeqRef.current = 0;
      dispatch({ type: 'reset' });
    }
    handledJoinsRef.current = joinsRef.current;
    const request: Promise<WindowAction & { page: { lastSeq: number } }> = aroundMessageId
      ? fetchAround(aroundMessageId).then((page) => ({ type: 'loadedAround', page }))
      : fetchPage(channelId).then((page) => ({ type: 'loadedLatest', page }));
    request.then(
      (action) => {
        if (gen !== genRef.current) return;
        dispatch(action);
        setError(null);
        afterPage(action.page.lastSeq);
      },
      (err: unknown) => {
        if (gen === genRef.current) setError(err);
      },
    );
  }, [channelId, aroundMessageId, afterPage, setError]);

  // Unmount (and StrictMode's rehearsal of it): drop pending answers, load afresh on remount.
  useEffect(
    () => () => {
      genRef.current += 1;
      channelRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const socket = getSocket();
    const onMessage = (event: ChatMessageEvent) => {
      // A socket can briefly sit in two group rooms while navigating.
      if (event.groupId !== groupId || event.channelId !== channelId) return;
      apply([event.message]);
    };
    socket.on(ChatEvents.message, onMessage);
    return () => {
      socket.off(ChatEvents.message, onMessage);
    };
  }, [groupId, channelId, apply]);

  // Catch-up after every rejoin of the group room, once the window is loaded.
  useEffect(() => {
    if (!window.loaded || joins === 0 || joins === handledJoinsRef.current) return;
    handledJoinsRef.current = joins;
    void catchUp();
  }, [joins, window.loaded, catchUp]);

  const loadPage = useCallback(
    async (side: 'older' | 'newer') => {
      const w = windowRef.current;
      const edge = side === 'older' ? w.messages[0] : w.messages.at(-1);
      const more = side === 'older' ? w.hasOlder : w.hasNewer;
      if (!edge || !more || busy.current[side]) return;
      busy.current[side] = true;
      const gen = genRef.current;
      try {
        const cursor = messageCursor(edge);
        const page = await fetchPage(
          channelId,
          side === 'older' ? { before: cursor } : { after: cursor },
        );
        if (gen !== genRef.current) return;
        dispatch({ type: side === 'older' ? 'loadedOlder' : 'loadedNewer', page });
        afterPage(page.lastSeq);
      } catch {
        // The next scroll to the edge asks again.
      } finally {
        busy.current[side] = false;
      }
    },
    [channelId, afterPage],
  );
  const loadOlder = useCallback(() => loadPage('older'), [loadPage]);
  const loadNewer = useCallback(() => loadPage('newer'), [loadPage]);

  /** Shows the newest page: fetched when it is not loaded (or the first load failed). */
  const jumpToLatest = useCallback(async () => {
    const w = windowRef.current;
    if (w.loaded && !w.hasNewer) return;
    try {
      const pageSeq = await loadLatest();
      if (pageSeq !== null) afterPage(pageSeq);
    } catch (err) {
      if (!w.loaded) setError(err);
    }
  }, [loadLatest, afterPage, setError]);

  const post = useCallback(
    async (input: SendMessageInput) => {
      try {
        // The answer settles the row even when its socket event is missed.
        apply([await sendMessage(channelId, input)]);
      } catch {
        dispatch({ type: 'pendingFailed', clientId: input.clientId });
      }
    },
    [channelId, apply],
  );

  /** Sends at once as a pending row; a failure marks it failed (never retried on its own). */
  const send = useCallback(
    (input: SendInput) => {
      const full: SendMessageInput = { ...input, clientId: crypto.randomUUID() };
      dispatch({ type: 'pendingAdded', input: full });
      return post(full);
    },
    [post],
  );

  /** Sends a failed row again with the same `clientId`, so the server never stores it twice. */
  const retry = useCallback(
    async (clientId: string) => {
      const pending = windowRef.current.pending.find((p) => p.clientId === clientId);
      if (!pending || pending.status !== 'failed') return;
      dispatch({ type: 'pendingRetried', clientId });
      await post(pending.input);
    },
    [post],
  );

  /** Marks the channel read up to `at` and moves the window's read cursor (not the anchor). */
  const markRead = useCallback(
    async (at: string) => {
      await postRead(channelId, at);
      dispatch({ type: 'readMarked', at });
    },
    [channelId],
  );

  return {
    window,
    loadOlder,
    loadNewer,
    jumpToLatest,
    send,
    retry,
    markRead,
    isLoading: !window.loaded && error === null,
    error,
  };
}
