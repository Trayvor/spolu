import { z } from 'zod';
import type { KnowledgeType } from './knowledge.js';
import type { Role } from './users.js';
import type { TicketStatus } from './tickets.js';

/**
 * Global search (`GET /api/search`, the Cmd/Ctrl+K palette and the MCP `search` tool): one
 * query string over every kind of item the caller may read, answered as one list per type.
 * See docs/superpowers/specs/2026-10-18-global-search-design.md.
 */
export const SearchTypes = [
  'groups',
  'tickets',
  'tasks',
  'knowledge',
  'projects',
  'people',
  'messages',
] as const;
export type SearchType = (typeof SearchTypes)[number];

export const SEARCH_LIMITS = {
  /** The query, trimmed: 2 to 100 characters. */
  minQuery: 2,
  maxQuery: 100,
  /** Hits per type: 5 by default (the palette), at most 20. */
  defaultPerType: 5,
  maxPerType: 20,
  /**
   * Messages (2026-10-19) need a term of at least 3 characters: the trigram index cannot serve
   * shorter ones on the biggest table.
   */
  minMessageTerm: 3,
  /** Hits per page of `GET /api/search/messages`: 20 by default and at most. */
  messagesPage: 20,
} as const;

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH_LIMITS.minQuery).max(SEARCH_LIMITS.maxQuery),
  /** A comma list of types; absent or empty means every type the caller may search. */
  types: z
    .string()
    .max(200)
    .optional()
    .transform((v) => [...new Set((v ?? '').split(',').filter(Boolean))])
    .pipe(z.array(z.enum(SearchTypes)))
    .transform((types) => (types.length === 0 ? [...SearchTypes] : types)),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEARCH_LIMITS.maxPerType)
    .default(SEARCH_LIMITS.defaultPerType),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/**
 * `GET /api/search/messages` (2026-10-19): one page of message hits. `cursor` is the previous
 * page's `nextCursor`; `groupId` narrows to one group (a group the caller does not read gives an
 * empty page).
 */
export const MessageSearchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH_LIMITS.minQuery).max(SEARCH_LIMITS.maxQuery),
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEARCH_LIMITS.messagesPage)
    .default(SEARCH_LIMITS.messagesPage),
  groupId: z.string().max(64).optional(),
});
export type MessageSearchQuery = z.infer<typeof MessageSearchQuerySchema>;

/** A group: a client, or the admin group "eGrant tím" (admins only). */
export type SearchGroupHit = { id: string; name: string; kind: 'client' | 'admin' };
export type SearchTicketHit = {
  id: string;
  number: number;
  subject: string | null;
  status: TicketStatus;
  groupId: string | null;
  groupName: string | null;
};
export type SearchTaskHit = {
  id: string;
  title: string;
  done: boolean;
  groupId: string;
  groupName: string;
};
export type SearchKnowledgeHit = {
  id: string;
  title: string;
  type: KnowledgeType;
  groupId: string;
  groupName: string;
};
/** A project, or an event of one (`projectId` is the event's project, or the project itself). */
export type SearchProjectHit = {
  id: string;
  kind: 'project' | 'event';
  name: string;
  projectId: string;
  /** The project's name, for an event. */
  projectName: string;
  groupId: string;
  groupName: string;
};
/** A person (admins only): `groupId` is the first group of their active memberships, if any. */
export type SearchPersonHit = {
  id: string;
  name: string;
  email: string;
  role: Role;
  groupId: string | null;
  groupName: string | null;
};

/**
 * A chat message (2026-10-19): of a group chat, a task chat or a ticket chat, or a reply in a
 * thread (`parentId` is its root). `snippet` is plain text (never HTML), at most 160 characters
 * plus `…` on a cut side; `highlights` are `[start, end)` offsets into it, sorted and disjoint.
 */
export type SearchMessageHit = {
  id: string;
  channelId: string;
  channelKind: 'group' | 'task' | 'ticket';
  parentId: string | null;
  groupId: string;
  groupName: string;
  taskId: string | null;
  taskTitle: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  /** Null: a deleted account. */
  authorName: string | null;
  /** ISO. */
  createdAt: string;
  snippet: string;
  highlights: [number, number][];
};

/** One page of `GET /api/search/messages`; `tooBroad`: the search hit its time limit. */
export type MessageSearchPage = {
  hits: SearchMessageHit[];
  nextCursor: string | null;
  tooBroad: boolean;
};

/** Only the types asked for (and allowed) are present. */
export type SearchResults = {
  groups?: SearchGroupHit[];
  tickets?: SearchTicketHit[];
  tasks?: SearchTaskHit[];
  knowledge?: SearchKnowledgeHit[];
  projects?: SearchProjectHit[];
  people?: SearchPersonHit[];
  messages?: SearchMessageHit[];
};
