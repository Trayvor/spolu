import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChatEvents,
  type ChatMessageEvent,
  type ChatMessageTasksEvent,
  type MessageDto,
  type SendMessageInput,
} from '@spolu/shared';
import { useGroupRoomJoins } from '@/features/groups/use-group-room';
import { ApiError } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import {
  chatUnreadQuery,
  fetchAround,
  fetchChanges,
  fetchPage,
  groupChatQuery,
  markRead as postRead,
  messageCursor,
  sendMessage,
  threadQuery,
  unreadThreadsQuery,
} from './api';
import {
  initialWindow,
  setTasksInThread,
  upsertIntoThread,
  windowReducer,
  type WindowAction,
} from './channel-window';

/** How many seqs a catch-up after a gap starts behind the last one seen. */
const CATCH_UP_OVERLAP = 20;

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
 * `error` is the error of the last first-page (or around) load. A failed older/newer page is
 * asked for again by the next scroll; a failed catch-up retries with backoff. Clearing `aroundMessageId` keeps the window where it is.
 */
export function useChannelMessages(
  channelId: string,
  opts: { groupId: string; aroundMessageId?: string },
) {
  const { groupId, aroundMessageId } = opts;
  const queryClient = useQueryClient();
  const joins = useGroupRoomJoins();
  const [win, dispatch] = useReducer(windowReducer, initialWindow);
  // Tagged with the channel, so a switch never shows the previous chat's error.
  const [failure, setFailure] = useState<{ channelId: string; error: unknown } | null>(null);
  const setError = useCallback(
    (error: unknown) => setFailure(error === null ? null : { channelId, error }),
    [channelId],
  );
  const error = failure?.channelId === channelId ? failure.error : null;
  /**
   * The last `aroundMessageId` whose load has finished, with the top-level message the page was
   * opened at (the message itself or its thread root), or null when it could not be shown (another
   * chat's message, or the request failed; the newest page is shown instead).
   */
  const [around, setAround] = useState<{ messageId: string; targetId: string | null } | null>(null);

  // Mirrors for async callbacks. `lastSeqRef` is the authority for catch-up (it moves
  // synchronously); `win.lastSeq` is the same value as rendered state.
  const windowRef = useRef(win);
  const joinsRef = useRef(joins);
  const lastSeqRef = useRef(0);
  /** A full page (latest or around) has arrived for this channel, so `lastSeqRef` means something. */
  const seqKnownRef = useRef(false);
  /**
   * The open gap after a socket disconnect: catch-up must start at `from` (null: at the next
   * full page's seq), whatever live events arrive meanwhile. Cleared by a successful rejoin
   * catch-up that started with the same `epoch` (a newer disconnect opens a new epoch).
   */
  const gapRef = useRef<{ from: number | null; epoch: number } | null>(null);
  const epochRef = useRef(0);
  /** The channel the window holds; null until the first load starts and after unmount. */
  const channelRef = useRef<string | null>(null);
  /** Bumped on a channel switch and on unmount: catch-ups and their retries stop. */
  const sessionRef = useRef(0);
  /** Bumped whenever the window is replaced; page answers of an older window are dropped. */
  const genRef = useRef(0);
  /** The join counter the window is current with. */
  const handledJoinsRef = useRef(0);
  const catchUpChain = useRef<Promise<void>>(Promise.resolve());
  /** The one waiting catch-up retry of this channel (a newer catch-up replaces it). */
  const retryRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    from: number;
    gapEpoch: number | null;
    attempt: number;
  } | null>(null);
  const busy = useRef({ older: false, newer: false });

  useEffect(() => {
    windowRef.current = win;
    joinsRef.current = joins;
  });

  /**
   * Puts messages into the window and the cached threads. Server changes (`local` false) also
   * move the catch-up seq; a local result (`local` true) never does, because its `changeSeq` may
   * be made up and the server's own change still has to arrive by event or catch-up.
   */
  const put = useCallback(
    (incoming: MessageDto[], local: boolean) => {
      // An answer that arrives after a channel switch belongs to the old channel.
      const messages = incoming.filter((m) => m.channelId === channelRef.current);
      if (messages.length === 0) return;
      dispatch({ type: 'upsert', messages, local });
      const readUpTo = windowRef.current.lastReadAt;
      let unreadDeleted = false;
      let replyDeleted = false;
      for (const m of messages) {
        if (!local) lastSeqRef.current = Math.max(lastSeqRef.current, m.changeSeq);
        const { queryKey } = threadQuery(m.parentId ?? m.id);
        const thread = queryClient.getQueryData(queryKey);
        if (thread) {
          queryClient.setQueryData(queryKey, upsertIntoThread(thread, m));
        } else if (queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching') {
          // The answer being fetched may predate this message: ask again.
          void queryClient.invalidateQueries({ queryKey });
        }
        if (m.parentId === null && m.deletedAt !== null) {
          unreadDeleted ||= readUpTo === null || m.createdAt > readUpTo;
        }
        // Whether it was unread for the reader only the server knows (replies are rarely deleted).
        replyDeleted ||= m.parentId !== null && m.deletedAt !== null;
      }
      // The unread count would stay too high (the badge only counts up from events).
      if (unreadDeleted || replyDeleted) {
        void queryClient.invalidateQueries({ queryKey: groupChatQuery(groupId).queryKey });
      }
      if (replyDeleted) {
        void queryClient.invalidateQueries({ queryKey: unreadThreadsQuery(channelId).queryKey });
      }
    },
    [queryClient, groupId, channelId],
  );
  const apply = useCallback((incoming: MessageDto[]) => put(incoming, false), [put]);

  /**
   * Applies the answer to the reader's own edit (the updated message) or delete (a local copy
   * marked deleted, with a made-up `changeSeq`). Seq-neutral: it never moves `lastSeq` or the
   * catch-up bookkeeping.
   */
  const applyLocal = useCallback((message: MessageDto) => put([message], true), [put]);

  /**
   * Records the seq of a full page (latest or around) that just arrived. True when a live event
   * newer than the page came in meanwhile: the page may then hold an older version of a row (its
   * event was ignored or overwritten), so everything after the page's seq is asked for again.
   * Older and newer pages never record their seq (it says nothing about the other rows); they
   * only make the same check.
   */
  const fullPageIsBehind = (pageSeq: number): boolean => {
    seqKnownRef.current = true;
    if (gapRef.current?.from === null) gapRef.current.from = pageSeq;
    if (lastSeqRef.current > pageSeq) return true;
    lastSeqRef.current = pageSeq;
    return false;
  };

  /** Replaces the window with the newest page. Its seq, or null when the answer came too late. */
  const loadLatest = useCallback(async (): Promise<number | null> => {
    const gen = ++genRef.current;
    const page = await fetchPage(channelId);
    if (gen !== genRef.current) return null;
    dispatch({ type: 'loadedLatest', page });
    setError(null);
    // Replies changed in a skipped range never reached the cached threads.
    void queryClient.invalidateQueries({ queryKey: ['chat', 'thread'] });
    return page.lastSeq;
  }, [channelId, queryClient, setError]);

  /**
   * Applies what changed after `from`, one run at a time. A failure (of the changes request or
   * of the truncated reload) retries from the same `from` after 1 s, 2 s, 4 s … at most 30 s,
   * until it succeeds or the channel changes; 403 and 404 are permanent (the reader lost access)
   * and stop it. There is one waiting retry per channel: a newer catch-up takes its place and
   * starts from the earlier of the two `from`s. A run that closes `gapEpoch` clears the gap.
   */
  const runCatchUp = useCallback(
    function run(from: number, gapEpoch: number | null, attempt = 0): Promise<void> {
      const waiting = retryRef.current;
      if (waiting) {
        clearTimeout(waiting.timer);
        retryRef.current = null;
        from = Math.min(from, waiting.from);
        gapEpoch ??= waiting.gapEpoch;
        attempt = Math.max(attempt, waiting.attempt);
      }
      const session = sessionRef.current;
      const once = async () => {
        if (session !== sessionRef.current) return;
        let after = from;
        for (;;) {
          const changes = await fetchChanges(channelId, after);
          if (session !== sessionRef.current) return;
          apply(changes.messages);
          if (!changes.truncated) break;
          // More than one catch-up answer missed: the newest page is cheaper than paging through.
          const pageSeq = await loadLatest();
          if (session !== sessionRef.current || pageSeq === null) return;
          if (!fullPageIsBehind(pageSeq)) break;
          after = pageSeq;
        }
        if (gapEpoch !== null && gapRef.current?.epoch === gapEpoch) gapRef.current = null;
      };
      const retry = (error: unknown) => {
        if (session !== sessionRef.current) return;
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return;
        // Two runs started before either failed: keep one timer, from the earlier `from`.
        const other = retryRef.current;
        let start = from;
        let epoch = gapEpoch;
        let tries = attempt;
        if (other) {
          clearTimeout(other.timer);
          start = Math.min(start, other.from);
          epoch ??= other.gapEpoch;
          tries = Math.max(tries, other.attempt);
        }
        const timer = setTimeout(
          () => {
            retryRef.current = null;
            if (session === sessionRef.current) void run(start, epoch, tries + 1);
          },
          Math.min(1000 * 2 ** tries, 30_000),
        );
        retryRef.current = { timer, from: start, gapEpoch: epoch, attempt: tries };
      };
      catchUpChain.current = catchUpChain.current.then(once).catch(retry);
      return catchUpChain.current;
    },
    [channelId, apply, loadLatest],
  );

  /** After an older or newer page: catch up from it when a live event overtook it. */
  const afterPartialPage = useCallback(
    (pageSeq: number) => {
      if (lastSeqRef.current > pageSeq) void runCatchUp(pageSeq, null);
    },
    [runCatchUp],
  );
  const afterFullPage = useCallback(
    (pageSeq: number) => {
      if (fullPageIsBehind(pageSeq)) void runCatchUp(pageSeq, null);
    },
    [runCatchUp],
  );

  // First page; again when the channel changes or a new message is to be shown.
  useEffect(() => {
    if (aroundMessageId === undefined && channelRef.current === channelId) return;
    const gen = ++genRef.current;
    if (channelRef.current !== channelId) {
      channelRef.current = channelId;
      sessionRef.current += 1;
      lastSeqRef.current = 0;
      seqKnownRef.current = false;
      gapRef.current = null;
      dispatch({ type: 'reset' });
    }
    handledJoinsRef.current = joinsRef.current;
    const latest = () =>
      fetchPage(channelId).then((page): WindowAction & { page: { lastSeq: number } } => ({
        type: 'loadedLatest',
        page,
      }));
    const request = aroundMessageId
      ? fetchAround(aroundMessageId).then((page) =>
          // A message of another chat is never shown here: this chat opens at its newest page.
          page.messages.every((m) => m.channelId === channelId)
            ? { type: 'loadedAround' as const, page, channelId }
            : latest(),
        )
      : latest();
    request.then(
      (action) => {
        if (gen !== genRef.current) return;
        dispatch(action);
        setError(null);
        afterFullPage(action.page.lastSeq);
        if (aroundMessageId) {
          const targetId = action.type === 'loadedAround' ? action.page.targetId : null;
          setAround({ messageId: aroundMessageId, targetId });
        }
      },
      (err: unknown) => {
        if (gen !== genRef.current) return;
        setError(err);
        if (aroundMessageId) setAround({ messageId: aroundMessageId, targetId: null });
      },
    );
  }, [channelId, aroundMessageId, afterFullPage, setError]);

  // Unmount (and StrictMode's rehearsal of it): drop pending answers and retries, load afresh
  // on remount.
  useEffect(() => {
    return () => {
      genRef.current += 1;
      sessionRef.current += 1;
      channelRef.current = null;
      if (retryRef.current) clearTimeout(retryRef.current.timer);
      retryRef.current = null;
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onMessage = (event: ChatMessageEvent) => {
      // A socket can briefly sit in two group rooms while navigating.
      if (event.groupId !== groupId || event.channelId !== channelId) return;
      apply([event.message]);
    };
    // Events stop here; catch-up after the rejoin starts from this seq, not from a live event
    // that may arrive between the rejoin and the catch-up request.
    const onDisconnect = () => {
      if (channelRef.current !== channelId) return;
      const from = gapRef.current?.from ?? (seqKnownRef.current ? lastSeqRef.current : null);
      gapRef.current = { from, epoch: ++epochRef.current };
    };
    const onMessageTasks = (event: ChatMessageTasksEvent) => {
      if (event.groupId !== groupId || event.channelId !== channelId) return;
      dispatch({ type: 'tasksChanged', messageId: event.messageId, tasks: event.tasks });
      const { queryKey } = threadQuery(event.parentId ?? event.messageId);
      const thread = queryClient.getQueryData(queryKey);
      if (thread) {
        queryClient.setQueryData(queryKey, setTasksInThread(thread, event.messageId, event.tasks));
      }
    };
    socket.on(ChatEvents.message, onMessage);
    socket.on(ChatEvents.messageTasks, onMessageTasks);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off(ChatEvents.message, onMessage);
      socket.off(ChatEvents.messageTasks, onMessageTasks);
      socket.off('disconnect', onDisconnect);
    };
  }, [groupId, channelId, apply, queryClient]);

  // Catch-up after every rejoin of the group room, once the window is loaded.
  useEffect(() => {
    if (!win.loaded || joins === 0 || joins === handledJoinsRef.current) return;
    handledJoinsRef.current = joins;
    const gap = gapRef.current;
    // Starts a little behind: live events can overtake each other by a few seqs, and the
    // reducer ignores a change it already holds (same `changeSeq`).
    const from = Math.max((gap?.from ?? lastSeqRef.current) - CATCH_UP_OVERLAP, 0);
    void runCatchUp(from, gap?.epoch ?? null);
  }, [joins, win.loaded, runCatchUp]);

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
        afterPartialPage(page.lastSeq);
      } catch {
        // The next scroll to the edge asks again.
      } finally {
        busy.current[side] = false;
      }
    },
    [channelId, afterPartialPage],
  );
  const loadOlder = useCallback(() => loadPage('older'), [loadPage]);
  const loadNewer = useCallback(() => loadPage('newer'), [loadPage]);

  /** Shows the newest page: fetched when it is not loaded (or the first load failed). */
  const jumpToLatest = useCallback(async () => {
    const w = windowRef.current;
    if (w.loaded && !w.hasNewer) return;
    try {
      const pageSeq = await loadLatest();
      if (pageSeq !== null) afterFullPage(pageSeq);
    } catch (err) {
      if (!w.loaded) setError(err);
    }
  }, [loadLatest, afterFullPage, setError]);

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

  /**
   * Marks the channel read up to `at` and moves the window's read cursor (not the anchor). The
   * unread counts (the Chat tab and the groups list) are asked for again.
   */
  const markRead = useCallback(
    async (at: string) => {
      await postRead(channelId, at);
      dispatch({ type: 'readMarked', at });
      void queryClient.invalidateQueries({ queryKey: groupChatQuery(groupId).queryKey });
      void queryClient.invalidateQueries({ queryKey: chatUnreadQuery.queryKey });
    },
    [channelId, groupId, queryClient],
  );

  return {
    window: win,
    loadOlder,
    loadNewer,
    jumpToLatest,
    send,
    retry,
    markRead,
    applyLocal,
    around,
    isLoading: !win.loaded && error === null,
    error,
  };
}
