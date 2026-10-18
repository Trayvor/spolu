import type { Me, SearchResults } from '@spolu/shared';
import { navSections } from '@/components/nav-sections';
import { isAdmin } from '@/features/auth/roles';

/** Where a palette item leads: a route of the app router, its params and search. */
export type PaletteLink = {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
};

export type PaletteKind =
  'action' | 'group' | 'ticket' | 'task' | 'knowledge' | 'project' | 'event' | 'person';

/** One row of the palette: a quick action, a recent item or a search hit. */
export type PaletteItem = {
  /** Unique in the list: the kind and the id. */
  key: string;
  kind: PaletteKind;
  /** The main line, as shown. */
  label: string;
  /** A second, quieter line: the client, the project, the email. */
  detail?: string;
  /** A ticket's `#123`. */
  badge?: string;
  /** A done task, a resolved ticket: shown dimmed. */
  closed?: boolean;
  /** For an action: the i18n key of its label (the label is translated when shown). */
  labelKey?: string;
  link: PaletteLink;
};

export type PaletteSection = { key: string; items: PaletteItem[] };

/** The search sections in the order the palette shows them. */
export const RESULT_ORDER = [
  'groups',
  'tickets',
  'tasks',
  'knowledge',
  'projects',
  'people',
] as const;

/** The hits of one answer as palette items, per section, in `RESULT_ORDER`; empty ones dropped. */
export function resultSections(results: SearchResults): PaletteSection[] {
  const sections: PaletteSection[] = [
    {
      key: 'groups',
      items: (results.groups ?? []).map((g) => ({
        key: `group:${g.id}`,
        kind: 'group',
        label: g.name,
        link: { to: '/groups/$groupId/chat', params: { groupId: g.id } },
      })),
    },
    {
      key: 'tickets',
      items: (results.tickets ?? []).map((t) => ({
        key: `ticket:${t.id}`,
        kind: 'ticket',
        label: t.subject ?? `#${t.number}`,
        badge: `#${t.number}`,
        detail: t.groupName ?? undefined,
        closed: t.status === 'resolved',
        link: { to: '/tickets/$ticketId', params: { ticketId: t.id } },
      })),
    },
    {
      key: 'tasks',
      items: (results.tasks ?? []).map((t) => ({
        key: `task:${t.id}`,
        kind: 'task',
        label: t.title,
        detail: t.groupName,
        closed: t.done,
        link: {
          to: '/groups/$groupId/tasks/$taskId',
          params: { groupId: t.groupId, taskId: t.id },
        },
      })),
    },
    {
      key: 'knowledge',
      items: (results.knowledge ?? []).map((k) => ({
        key: `knowledge:${k.id}`,
        kind: 'knowledge',
        label: k.title,
        detail: k.groupName,
        link: {
          to: '/groups/$groupId/knowledge',
          params: { groupId: k.groupId },
          search: { k: k.id },
        },
      })),
    },
    {
      key: 'projects',
      items: (results.projects ?? []).map((p) => ({
        key: `${p.kind}:${p.id}`,
        kind: p.kind,
        label: p.name,
        detail: p.kind === 'event' ? `${p.projectName}, ${p.groupName}` : p.groupName,
        link: {
          to: '/groups/$groupId/overview',
          params: { groupId: p.groupId },
          search: { project: p.projectId },
        },
      })),
    },
    {
      key: 'people',
      items: (results.people ?? []).flatMap((p): PaletteItem[] => {
        const link: PaletteLink | null =
          p.role !== 'client'
            ? { to: '/admins' }
            : p.groupId
              ? { to: '/groups/$groupId/members', params: { groupId: p.groupId } }
              : null;
        if (!link) return [];
        const name = p.name || p.email;
        return [
          {
            key: `person:${p.id}`,
            kind: 'person',
            label: name,
            detail: p.groupName ? `${p.email}, ${p.groupName}` : p.email,
            link,
          },
        ];
      }),
    },
  ];
  return sections.filter((s) => s.items.length > 0);
}

/**
 * The quick actions: the person's sections (as in the header), Settings, and "New task" while a
 * group is open. `groupId` is the open group's id, if any.
 */
export function quickActions(user: Me, groupId: string | undefined): PaletteItem[] {
  const actions: PaletteItem[] = navSections(user)
    .filter((s) => s.label)
    .map((s) => ({
      key: `action:${s.key}`,
      kind: 'action',
      label: '',
      labelKey: s.label!,
      link: { to: s.to },
    }));
  actions.push({
    key: 'action:settings',
    kind: 'action',
    label: '',
    labelKey: 'nav.settings',
    link: { to: '/settings' },
  });
  // Admins have Home among their sections; anyone else gets it here.
  if (!isAdmin(user)) {
    actions.unshift({
      key: 'action:home',
      kind: 'action',
      label: '',
      labelKey: 'nav.home',
      link: { to: '/' },
    });
  }
  // The one action that does something here, first.
  if (groupId) {
    actions.unshift({
      key: 'action:newTask',
      kind: 'action',
      label: '',
      labelKey: 'search.actions.newTask',
      link: { to: '/groups/$groupId/tasks/new', params: { groupId } },
    });
  }
  return actions;
}

/** Folded like the server's search (diacritics and case ignored), for filtering actions. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

const RECENT_KEY = 'spolu.search.recent';
const RECENT_MAX = 8;

/** The last opened items (per browser), newest first; empty when storage is blocked. */
export function readRecent(userId: string): PaletteItem[] {
  try {
    const raw = localStorage.getItem(`${RECENT_KEY}.${userId}`);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as PaletteItem[]).filter((i) => i && i.key && i.link) : [];
  } catch {
    return [];
  }
}

/** Remembers an opened hit (actions are not remembered). */
export function rememberRecent(userId: string, item: PaletteItem): void {
  if (item.kind === 'action') return;
  try {
    const next = [item, ...readRecent(userId).filter((i) => i.key !== item.key)].slice(
      0,
      RECENT_MAX,
    );
    localStorage.setItem(`${RECENT_KEY}.${userId}`, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode): the palette works without recent items.
  }
}
