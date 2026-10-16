import type {
  AroundPage,
  MessageDto,
  MessagePage,
  MessageTaskLink,
  SendMessageInput,
  Thread,
} from '@spolu/shared';

/**
 * The slice of one chat kept in memory: a contiguous run of top-level messages plus the
 * messages being sent. Pure; `useChannelMessages` feeds it pages, live events and catch-up.
 */

/** At most this many top-level messages stay in memory; the rest is re-fetched when scrolled to. */
export const MAX_IN_MEMORY = 300;

/** A message being sent (or that failed). A thread reply carries `input.parentId`. */
export type Pending = { clientId: string; input: SendMessageInput; status: 'sending' | 'failed' };

export type ChannelWindow = {
  /** Top-level messages, oldest first, without gaps. */
  messages: MessageDto[];
  /** Older top-level messages exist on the server but not in `messages`. */
  hasOlder: boolean;
  /** Newer top-level messages exist on the server but not in `messages`. */
  hasNewer: boolean;
  /** The highest change seq seen; catch-up asks for what changed after it. */
  lastSeq: number;
  /** The read cursor: moves forward with the server's answers and `readMarked`. */
  lastReadAt: string | null;
  /**
   * The read cursor as it was when the chat opened. The "New messages" line sits here and stays
   * put while the chat is read, even after reloads.
   */
  unreadAnchor: string | null;
  /** The first page has arrived. */
  loaded: boolean;
  pending: Pending[];
};

export type WindowAction =
  | { type: 'reset' }
  | { type: 'loadedLatest'; page: MessagePage }
  | { type: 'loadedOlder'; page: MessagePage }
  | { type: 'loadedNewer'; page: MessagePage }
  /** `channelId`: the chat the window belongs to; a page of another chat is ignored. */
  | { type: 'loadedAround'; page: AroundPage; channelId: string }
  /** `local`: a result of the reader's own edit or delete; it never moves `lastSeq`. */
  | { type: 'upsert'; messages: MessageDto[]; local?: boolean }
  /** The tasks made from a message changed; no `changeSeq` moves, so `upsert` would drop it. */
  | { type: 'tasksChanged'; messageId: string; tasks: MessageTaskLink[] }
  | { type: 'pendingAdded'; input: SendMessageInput }
  | { type: 'pendingFailed'; clientId: string }
  | { type: 'pendingRetried'; clientId: string }
  | { type: 'readMarked'; at: string };

export const initialWindow: ChannelWindow = {
  messages: [],
  hasOlder: false,
  hasNewer: false,
  lastSeq: 0,
  lastReadAt: null,
  unreadAnchor: null,
  loaded: false,
  pending: [],
};

/** Server order of top-level messages: `(createdAt, id)`. ISO times of equal format sort as text. */
function compare(a: MessageDto, b: MessageDto): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const later = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null || a >= b ? a : b;

/** Merges two oldest-first runs by id; of two versions of a row the higher `changeSeq` wins. */
function merge(rows: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  const byId = new Map(rows.map((m) => [m.id, m]));
  for (const m of incoming) {
    const old = byId.get(m.id);
    if (!old || m.changeSeq > old.changeSeq) byId.set(m.id, m);
  }
  return [...byId.values()].sort(compare);
}

/** Drops the pending rows whose message has arrived. */
function settlePending(pending: Pending[], arrived: MessageDto[]): Pending[] {
  if (pending.length === 0) return pending;
  const done = new Set(arrived.map((m) => m.clientId));
  const left = pending.filter((p) => !done.has(p.clientId));
  return left.length === pending.length ? pending : left;
}

/** Replaces the whole window with a fresh page (first load, jump to latest, reload). */
function replaced(
  state: ChannelWindow,
  messages: MessageDto[],
  page: { hasOlder: boolean; hasNewer: boolean; lastSeq: number; lastReadAt: string | null },
): ChannelWindow {
  return {
    messages,
    hasOlder: page.hasOlder,
    hasNewer: page.hasNewer,
    lastSeq: Math.max(state.lastSeq, page.lastSeq),
    lastReadAt: later(state.lastReadAt, page.lastReadAt),
    unreadAnchor: state.loaded ? state.unreadAnchor : page.lastReadAt,
    loaded: true,
    pending: settlePending(state.pending, messages),
  };
}

/** Keeps the newest MAX_IN_MEMORY rows (new rows came in at the bottom). */
function capKeepingNewest(state: ChannelWindow, messages: MessageDto[]): ChannelWindow {
  if (messages.length <= MAX_IN_MEMORY) return { ...state, messages };
  return { ...state, messages: messages.slice(-MAX_IN_MEMORY), hasOlder: true };
}

function upsert(state: ChannelWindow, incoming: MessageDto[], local: boolean): ChannelWindow {
  const lastSeq = local
    ? state.lastSeq
    : Math.max(state.lastSeq, ...incoming.map((m) => m.changeSeq));
  const pending = settlePending(state.pending, incoming);
  const first = state.messages[0];
  const last = state.messages.at(-1);
  const index = new Map(state.messages.map((m, i) => [m.id, i]));
  const taken = incoming.filter((m) => {
    if (m.parentId !== null) return false;
    const at = index.get(m.id);
    if (at !== undefined) return m.changeSeq > state.messages[at]!.changeSeq;
    // A row outside the loaded run would leave a gap; it is fetched with its page instead.
    if (state.hasOlder && first && compare(m, first) < 0) return false;
    if (state.hasNewer && last && compare(m, last) > 0) return false;
    return true;
  });
  if (taken.length === 0) {
    if (lastSeq === state.lastSeq && pending === state.pending) return state;
    return { ...state, lastSeq, pending };
  }
  return capKeepingNewest({ ...state, lastSeq, pending }, merge(state.messages, taken));
}

function setPendingStatus(
  state: ChannelWindow,
  clientId: string,
  status: Pending['status'],
): ChannelWindow {
  return {
    ...state,
    pending: state.pending.map((p) => (p.clientId === clientId ? { ...p, status } : p)),
  };
}

export function windowReducer(state: ChannelWindow, action: WindowAction): ChannelWindow {
  switch (action.type) {
    case 'reset':
      return initialWindow;
    case 'loadedLatest': {
      const { page } = action;
      return replaced(state, [...page.messages].reverse(), {
        ...page,
        hasOlder: page.hasMore,
        hasNewer: false,
      });
    }
    case 'loadedAround':
      // `/messages/:id/around` answers for any readable message, so it may be another chat's.
      if (action.page.messages.some((m) => m.channelId !== action.channelId)) return state;
      return replaced(state, action.page.messages, action.page);
    // An older or newer page says nothing about changes to the rows already loaded, so
    // `lastSeq` stays: moving it could skip an edit that catch-up still has to deliver.
    case 'loadedOlder': {
      const messages = merge(state.messages, action.page.messages);
      const next = { ...state, hasOlder: action.page.hasMore };
      if (messages.length <= MAX_IN_MEMORY) return { ...next, messages };
      return { ...next, messages: messages.slice(0, MAX_IN_MEMORY), hasNewer: true };
    }
    case 'loadedNewer':
      return capKeepingNewest(
        { ...state, hasNewer: action.page.hasMore },
        merge(state.messages, action.page.messages),
      );
    case 'upsert':
      return upsert(state, action.messages, action.local ?? false);
    case 'tasksChanged': {
      const at = state.messages.findIndex((m) => m.id === action.messageId);
      if (at === -1) return state;
      const messages = state.messages.slice();
      messages[at] = { ...messages[at]!, tasks: action.tasks };
      return { ...state, messages };
    }
    case 'pendingAdded':
      return {
        ...state,
        pending: [
          ...state.pending,
          { clientId: action.input.clientId, input: action.input, status: 'sending' },
        ],
      };
    case 'pendingFailed':
      return setPendingStatus(state, action.clientId, 'failed');
    case 'pendingRetried':
      return setPendingStatus(state, action.clientId, 'sending');
    case 'readMarked': {
      const lastReadAt = later(state.lastReadAt, action.at);
      return lastReadAt === state.lastReadAt ? state : { ...state, lastReadAt };
    }
  }
}

/**
 * A cached thread with one message applied: its root, or one of its replies (added in order or
 * replaced when newer). Returns the same object when nothing changes.
 */
export function upsertIntoThread(thread: Thread, m: MessageDto): Thread {
  if (m.id === thread.root.id) {
    return m.changeSeq > thread.root.changeSeq ? { ...thread, root: m } : thread;
  }
  if (m.parentId !== thread.root.id) return thread;
  const old = thread.replies.find((r) => r.id === m.id);
  if (old && m.changeSeq <= old.changeSeq) return thread;
  return { ...thread, replies: merge(thread.replies, [m]) };
}

/** A cached thread with the task links of its root or one of its replies replaced. */
export function setTasksInThread(
  thread: Thread,
  messageId: string,
  tasks: MessageTaskLink[],
): Thread {
  if (thread.root.id === messageId) return { ...thread, root: { ...thread.root, tasks } };
  if (!thread.replies.some((r) => r.id === messageId)) return thread;
  return {
    ...thread,
    replies: thread.replies.map((r) => (r.id === messageId ? { ...r, tasks } : r)),
  };
}
