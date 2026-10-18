import type { Me } from '@spolu/shared';
import { clientGroups, isAdmin } from '@/features/auth/roles';
import { currentSection, navSections, type NavSection } from './nav-sections';

/**
 * One item of the phone bottom bar. `label` is an i18n key; `count` names the badge the item
 * carries (admins' Tasks and Tickets counts, a client's Chat and Tasks unseen counts).
 */
export type BarItem =
  | {
      key: 'home' | 'groups' | 'tasks' | 'tickets';
      label: string;
      to: '/' | '/groups' | '/tasks' | '/tickets';
      count?: 'tasks' | 'tickets';
    }
  | {
      key: 'chat' | 'groupTasks' | 'groupTickets' | 'knowledge';
      label: string;
      to:
        | '/groups/$groupId/chat'
        | '/groups/$groupId/tasks'
        | '/groups/$groupId/tickets'
        | '/groups/$groupId/knowledge';
      groupId: string;
      count?: 'chat' | 'groupTasks';
    };

export type BottomNavPlan = {
  items: readonly BarItem[];
  /** The sections behind "More". */
  more: readonly NavSection[];
  /** The "More" section the page belongs to, if any. */
  moreCurrent: NavSection | undefined;
};

/** The client's group the bar leads into: the one in the URL, else the last one seen. */
let lastGroupId: string | undefined;

/** Screens that need the whole window (a composer, a full-screen panel): the bar steps aside. */
const FULL_SCREEN = [
  /^\/groups\/[^/]+\/tasks\/.+/,
  /^\/tickets\/[^/]+$/,
  /^\/bulk-email\/.+/,
  /^\/(welcome|join|unsubscribe|oauth)(\/|$)/,
];

export const isFullScreenPath = (pathname: string) => FULL_SCREEN.some((re) => re.test(pathname));

const ADMIN_BAR: readonly BarItem[] = [
  { key: 'home', label: 'nav.home', to: '/' },
  { key: 'groups', label: 'nav.groups', to: '/groups' },
  { key: 'tasks', label: 'nav.tasks', to: '/tasks', count: 'tasks' },
  { key: 'tickets', label: 'nav.tickets', to: '/tickets', count: 'tickets' },
];
const ADMIN_BAR_KEYS: ReadonlySet<string> = new Set(ADMIN_BAR.map((item) => item.key));

/**
 * What the phone bottom bar shows (four items and "More"), or null for no bar.
 * - Admins: Home, Groups, Tasks, Tickets; More holds the other sections (Knowledge, Financie,
 *   Admins, Bulk email).
 * - Clients: Chat, Tasks, Tickets, Knowledge of their group (the one in the URL, else the last
 *   one they were in, else their only one); More holds Overview, Members and, for several
 *   groups, My groups. A client with several groups who has not opened one yet gets no bar.
 * - A requester who is no client anywhere has one link in the header: no bar.
 */
export function bottomNavPlan(user: Me, pathname: string): BottomNavPlan | null {
  if (isFullScreenPath(pathname)) return null;
  if (isAdmin(user)) {
    const more = navSections(user).filter((section) => !ADMIN_BAR_KEYS.has(section.key));
    return { items: ADMIN_BAR, more, moreCurrent: currentSection(more, pathname) };
  }
  const mine = clientGroups(user);
  if (mine.length === 0) return null;
  const inUrl = /^\/groups\/([^/]+)/.exec(pathname)?.[1];
  if (inUrl && mine.some((g) => g.id === inUrl)) lastGroupId = inUrl;
  const groupId =
    lastGroupId && mine.some((g) => g.id === lastGroupId)
      ? lastGroupId
      : mine.length === 1
        ? mine[0]!.id
        : undefined;
  if (!groupId) return null;
  const params = { groupId };
  const more: NavSection[] = [
    {
      key: 'overview',
      to: '/groups/$groupId/overview',
      params,
      label: 'group.tabs.overview',
      match: [],
    },
    {
      key: 'members',
      to: '/groups/$groupId/members',
      params,
      label: 'group.tabs.members',
      match: [],
    },
  ];
  if (mine.length > 1) {
    more.push({ key: 'myGroups', to: '/my-groups', label: 'nav.myGroups', match: ['/my-groups'] });
  }
  const onMore = (section: NavSection) =>
    section.key === 'myGroups'
      ? pathname === '/my-groups'
      : pathname.startsWith(`/groups/${groupId}/${section.key}`);
  return {
    items: [
      {
        key: 'chat',
        label: 'group.tabs.chat',
        to: '/groups/$groupId/chat',
        groupId,
        count: 'chat',
      },
      {
        key: 'groupTasks',
        label: 'group.tabs.tasks',
        to: '/groups/$groupId/tasks',
        groupId,
        count: 'groupTasks',
      },
      { key: 'groupTickets', label: 'group.tabs.tickets', to: '/groups/$groupId/tickets', groupId },
      {
        key: 'knowledge',
        label: 'group.tabs.knowledge',
        to: '/groups/$groupId/knowledge',
        groupId,
      },
    ],
    more,
    moreCurrent: more.find(onMore),
  };
}
