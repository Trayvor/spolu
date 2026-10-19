import type {
  MessageSearchPage,
  MessageSearchQuery,
  SearchQuery,
  SearchResults,
  SearchType,
  SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { prepareSearch, type SearchText } from '../../infra/text/search.js';
import { groupAccessOf, type GroupAccess } from '../groups/memberships.js';
import { decodeMessageCursor, searchMessages } from '../chat/search.js';
import { searchGroups } from '../groups/search.js';
import { searchKnowledge } from '../knowledge/search.js';
import { searchProjects } from '../projects/search.js';
import { searchTasksOf } from '../tasks/search.js';
import { searchTickets } from '../tickets/search.js';
import { isAdmin } from '../users/policy.js';
import { searchPeople } from '../users/search.js';

type Searcher = (
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  limit: number,
) => Promise<NonNullable<SearchResults[SearchType]>>;

/** Each type is one module's exported search function; this module only composes them. */
const SEARCHERS: Record<SearchType, Searcher> = {
  groups: searchGroups,
  tickets: searchTickets,
  tasks: searchTasksOf,
  knowledge: searchKnowledge,
  projects: searchProjects,
  people: (db, actor, _access, text, limit) => searchPeople(db, actor, text, limit),
  // The first page only; `GET /api/search/messages` pages on. Too broad: no hits here.
  messages: (db, actor, access, text, limit) =>
    searchMessages(db, actor, access, text, { limit }).then((page) => page.hits),
};

/** An admin reads every group, so needs no memberships (and has none). */
const NO_ACCESS: GroupAccess = { roles: new Map() };

/**
 * `GET /api/search`: each asked type through its module's search function, in parallel; every
 * module scopes its one query by its own policy and checks each row with it again. One query per
 * type, up to six for messages (`searchMessages`), plus the caller's memberships (non-admins):
 * twelve at most for anyone. Only the types asked for are in the answer; `people` is admins only
 * and absent for others.
 */
export async function search(
  db: Db,
  actor: SessionUser,
  query: SearchQuery,
): Promise<SearchResults> {
  const admin = isAdmin(actor);
  const types = query.types.filter((type) => type !== 'people' || admin);
  const text = prepareSearch(query.q);
  const access = admin ? NO_ACCESS : await groupAccessOf(db, actor.id);
  const lists = await Promise.all(
    types.map((type) => SEARCHERS[type](db, actor, access, text, query.limit)),
  );
  return Object.fromEntries(types.map((type, i) => [type, lists[i]])) as SearchResults;
}

/**
 * `GET /api/search/messages` (2026-10-19): one page of message hits after `query.cursor`, within
 * `query.groupId` if given. A cursor that does not decode is `'invalid_cursor'` (400).
 */
export async function searchMessagePage(
  db: Db,
  actor: SessionUser,
  query: MessageSearchQuery,
): Promise<MessageSearchPage | 'invalid_cursor'> {
  const cursor = query.cursor === undefined ? undefined : decodeMessageCursor(query.cursor);
  if (cursor === null) return 'invalid_cursor';
  const access = isAdmin(actor) ? NO_ACCESS : await groupAccessOf(db, actor.id);
  return searchMessages(db, actor, access, prepareSearch(query.q), {
    limit: query.limit,
    cursor,
    groupId: query.groupId,
  });
}
