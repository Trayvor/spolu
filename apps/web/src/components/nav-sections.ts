import type { Me } from '@spolu/shared';
import { clientGroups, isAdmin, isRequester } from '@/features/auth/roles';

/**
 * One section of the app in the header: the inline links from 641 px, the section menu below
 * (`SectionMenu`). `label` is an i18n key, or `name` a text as is (a client's one group).
 * `count` shows the header's Tasks or Tickets count beside it (admins).
 */
export type NavSection = {
  key: string;
  to:
    | '/'
    | '/tasks'
    | '/tickets'
    | '/knowledge'
    | '/finance'
    | '/groups'
    | '/admins'
    | '/bulk-email'
    | '/my-groups';
  label?: string;
  name?: string;
  count?: 'tasks' | 'tickets';
  /** The path prefixes that belong to the section (`/` alone matches the home only). */
  match: readonly string[];
};

const ADMIN_SECTIONS: readonly NavSection[] = [
  { key: 'home', to: '/', label: 'nav.home', match: ['/'] },
  { key: 'tasks', to: '/tasks', label: 'nav.tasks', count: 'tasks', match: ['/tasks'] },
  { key: 'tickets', to: '/tickets', label: 'nav.tickets', count: 'tickets', match: ['/tickets'] },
  { key: 'knowledge', to: '/knowledge', label: 'nav.knowledge', match: ['/knowledge'] },
  { key: 'groups', to: '/groups', label: 'nav.groups', match: ['/groups'] },
  { key: 'admins', to: '/admins', label: 'nav.admins', match: ['/admins'] },
  { key: 'bulkEmail', to: '/bulk-email', label: 'nav.bulkEmail', match: ['/bulk-email'] },
];

/** Finance admins (Phase 32) also have Financie, after Knowledge. */
const FINANCE_SECTION: NavSection = {
  key: 'finance',
  to: '/finance',
  label: 'nav.finance',
  match: ['/finance'],
};
const FINANCE_ADMIN_SECTIONS: readonly NavSection[] = ADMIN_SECTIONS.flatMap((section) =>
  section.key === 'knowledge' ? [section, FINANCE_SECTION] : [section],
);

/**
 * The sections a person moves between, in header order. Admins: Home, Tasks, Tickets, Knowledge,
 * (Financie for a finance admin), Groups, Admins, Bulk email. Anyone else: "My groups" when they are a client of several groups
 * (or their one group, by name, when they also report tickets, so the menu leads back to it),
 * and their tickets ("Tickets" for a requester who is no client anywhere, else "My tickets").
 * A client of one group who reports nothing has no sections: the brand link is their way home.
 */
export function navSections(user: Me): readonly NavSection[] {
  if (isAdmin(user)) return user.finance ? FINANCE_ADMIN_SECTIONS : ADMIN_SECTIONS;
  const mine = clientGroups(user);
  const sections: NavSection[] = [];
  if (mine.length > 1) {
    sections.push({
      key: 'myGroups',
      to: '/my-groups',
      label: 'nav.myGroups',
      match: ['/my-groups', '/groups'],
    });
  }
  if (isRequester(user)) {
    if (mine.length === 1) {
      sections.push({ key: 'group', to: '/', name: mine[0]!.name, match: ['/groups'] });
    }
    sections.push({
      key: 'tickets',
      to: '/tickets',
      label: mine.length === 0 ? 'nav.tickets' : 'nav.myTickets',
      match: ['/tickets'],
    });
  }
  return sections;
}

/** The section the path belongs to, if any (`/settings` belongs to none). */
export function currentSection(
  sections: readonly NavSection[],
  pathname: string,
): NavSection | undefined {
  return sections.find((section) =>
    section.match.some((prefix) =>
      prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`),
    ),
  );
}
