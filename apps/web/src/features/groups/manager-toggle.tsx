import { useRef, useState, type MouseEvent } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  effectiveGroupMode,
  type GroupManager,
  type GroupMode,
  type GroupSummary,
  type ManagersResponse,
  type NotificationModes,
  type Role,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { useSession } from '@/features/auth/use-session';
import { notificationModesQuery } from '@/features/notifications/api';
import { cn } from '@/lib/utils';
import { becomeManager, groupsQuery, stopManaging } from './api';
import { busyGroups } from './manager-busy';

const GROUPS = groupsQuery.queryKey;
const MODES = notificationModesQuery.queryKey;

/** What one group looked like before a burst of clicks: put back if a request fails. */
type Snapshot = {
  managers: GroupManager[];
  managedByMe: boolean;
  override: GroupMode | undefined;
  inManagerSet: boolean;
  /** The effective mode before the burst, or undefined while the modes are not loaded. */
  mode: GroupMode | undefined;
};

function patchGroup(qc: QueryClient, groupId: string, patch: Partial<GroupSummary>) {
  qc.setQueryData<GroupSummary[]>(GROUPS, (old) =>
    old?.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
  );
}

function patchModes(qc: QueryClient, fn: (old: NotificationModes) => NotificationModes) {
  qc.setQueryData<NotificationModes>(MODES, (old) => (old ? fn(old) : old));
}

function withOverride(
  modes: NotificationModes,
  groupId: string,
  mode: GroupMode | undefined,
  inManagerSet: boolean,
): NotificationModes {
  const overrides = { ...modes.overrides };
  if (mode) overrides[groupId] = mode;
  else delete overrides[groupId];
  const managerSet = modes.managerSet.filter((id) => id !== groupId);
  if (inManagerSet) managerSet.push(groupId);
  return { ...modes, overrides, managerSet };
}

/** The mode the user has in a group without a row of its own there. */
const fallbackMode = (modes: NotificationModes, role: Role) =>
  effectiveGroupMode({ override: null, defaultMode: modes.defaultMode, role });

/**
 * "Manage" / "Managing": makes the signed-in admin a manager of the group, or stops it.
 * A sibling of the row's link, so it stops the click from reaching the row.
 *
 * Optimistic: the groups list (`managedByMe`, the admin in `managers`) and the bell (a manager
 * row with All when the admin had no mode of their own there; removed again on stop) change at
 * once. Clicks are serialized: one request at a time, a click while one is out is sent after it,
 * and only the answer to the last one sets the state. Any failure puts back what the group looked
 * like before the first click of the burst and shows the error.
 */
export function ManagerToggle({ group }: { group: GroupSummary }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useSession();
  const [error, setError] = useState(false);
  const [toast, setToast] = useState<{ key: number; text: string[] } | null>(null);
  const busy = useRef(false);
  /** What the user asked for last; the source of the next click while a burst is busy. */
  const desired = useRef(group.managedByMe);
  const queued = useRef<boolean | null>(null);
  const snapshot = useRef<Snapshot | null>(null);

  const groupId = group.id;

  function finish(answer: ManagersResponse) {
    const before = snapshot.current;
    snapshot.current = null;
    busyGroups.delete(groupId);
    // Events were skipped during the burst: the last answer is the truth.
    patchGroup(qc, groupId, { managers: answer.managers, managedByMe: answer.managedByMe });
    if (me) {
      patchModes(qc, (old) => {
        const own = old.overrides[groupId];
        const inSet = answer.managedByMe && old.managerSet.includes(groupId);
        // No row and the fallback already gives the answer: keep it without a row.
        const keepNoRow = own === undefined && fallbackMode(old, me.role) === answer.mode;
        return withOverride(old, groupId, keepNoRow ? undefined : answer.mode, inSet);
      });
    }
    // Back where the burst started (e.g. Manage, then Manage again): nothing to announce.
    if (before && before.managedByMe === answer.managedByMe) return;
    const changed = before?.mode !== undefined && before.mode !== answer.mode;
    const text = answer.managedByMe
      ? [
          t('groups.managers.started', { name: group.name }),
          ...(changed ? [t('groups.managers.startedMode')] : []),
        ]
      : [
          t('groups.managers.stopped', { name: group.name }),
          ...(changed
            ? [
                t('groups.managers.stoppedMode', {
                  mode: t(`notifications.mode.${answer.mode}`),
                }),
              ]
            : []),
        ];
    setToast((old) => ({ key: (old?.key ?? 0) + 1, text }));
  }

  function rollback() {
    const before = snapshot.current;
    snapshot.current = null;
    queued.current = null;
    busyGroups.delete(groupId);
    if (!before) return;
    patchGroup(qc, groupId, { managers: before.managers, managedByMe: before.managedByMe });
    patchModes(qc, (old) => withOverride(old, groupId, before.override, before.inManagerSet));
    desired.current = before.managedByMe;
    setError(true);
    // Events were skipped while busy and some requests may have gone through: ask the server.
    void qc.invalidateQueries({ queryKey: GROUPS, exact: true });
    void qc.invalidateQueries({ queryKey: MODES });
  }

  async function send(target: boolean) {
    busy.current = true;
    try {
      const answer = await (target ? becomeManager(groupId) : stopManaging(groupId));
      const next = queued.current;
      queued.current = null;
      if (next !== null && next !== answer.managedByMe) {
        void send(next);
        return;
      }
      busy.current = false;
      finish(answer);
    } catch {
      busy.current = false;
      rollback();
    }
  }

  function onClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!me) return;
    // While busy, events are not applied to the cache: go from the last click, not the cache.
    const next = !(busyGroups.has(groupId) ? desired.current : group.managedByMe);
    desired.current = next;
    setError(false);

    const modes = qc.getQueryData<NotificationModes>(MODES);
    if (!snapshot.current) {
      busyGroups.add(groupId);
      void qc.cancelQueries({ queryKey: GROUPS, exact: true });
      void qc.cancelQueries({ queryKey: MODES });
      snapshot.current = {
        managers: group.managers,
        managedByMe: group.managedByMe,
        override: modes?.overrides[groupId],
        inManagerSet: modes?.managerSet.includes(groupId) ?? false,
        mode: modes && (modes.overrides[groupId] ?? fallbackMode(modes, me.role)),
      };
    }

    const others = group.managers.filter((m) => m.id !== me.id);
    const managers = next
      ? [...others, { id: me.id, name: me.name }].sort((a, b) => a.name.localeCompare(b.name))
      : others;
    patchGroup(qc, groupId, { managers, managedByMe: next });
    patchModes(qc, (old) => {
      if (next && old.overrides[groupId] === undefined)
        return withOverride(old, groupId, 'all', true);
      if (!next && old.managerSet.includes(groupId))
        return withOverride(old, groupId, undefined, false);
      return old;
    });

    if (busy.current) queued.current = next;
    else void send(next);
  }

  const managing = group.managedByMe;
  return (
    <div className="relative flex shrink-0">
      <Button
        type="button"
        size="sm"
        variant={managing ? 'default' : 'secondary'}
        aria-pressed={managing}
        aria-label={t('groups.managers.toggleLabel', { name: group.name })}
        onClick={onClick}
        className={cn(
          // 32px pill with a 44px tap area.
          "relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
          managing && 'pl-3',
        )}
      >
        {managing && (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.5 10 17.5 19 7" />
          </svg>
        )}
        {managing ? t('groups.managers.managing') : t('groups.managers.manage')}
      </Button>
      {error && (
        <p
          role="alert"
          className="absolute top-full right-0 z-10 mt-2 w-max max-w-[240px] rounded-lg bg-card p-3 text-micro text-error-ink shadow-lift"
        >
          {t('groups.managers.error')}
        </p>
      )}
      {toast && (
        <Toast key={toast.key} onClose={() => setToast(null)}>
          {toast.text.join(' ')}
        </Toast>
      )}
    </div>
  );
}
