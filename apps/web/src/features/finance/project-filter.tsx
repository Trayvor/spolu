import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ProjectFilter } from '@spolu/shared';
import { useSession } from '@/features/auth/use-session';
import { groupsQuery } from '@/features/groups/api';
import { ProjectFilterPills } from '@/features/projects/project-filter';
import {
  readRemembered,
  rememberedFiltersKey,
  writeRemembered,
} from '@/lib/use-remembered-filters';
import type { FinanceView } from './api';

/**
 * The Project and Event filters of the Overview and the Work log (Phase 33 P6, spec §11,
 * decisions 23 and 24). A client's tab offers both; `/finance` only the Project pill, and only
 * while exactly one client is chosen (eGrant tím not counted). Each card remembers its choice
 * per person and per client (`finance.<card>.project.<groupId>`), like its period.
 */

/**
 * The client whose projects a view filters by, or null when it takes no project filter. On
 * `/finance` the admin group "eGrant tím" (`adminGroupId`, ticked by default, Phase 34 part E)
 * does not count as a client: one client with it still takes a project, which the server then
 * applies to that client alone.
 */
function projectFilterGroup(view: FinanceView, adminGroupId: string | null = null): string | null {
  if (view.kind === 'group') return view.groupId;
  const clients = view.clients.filter((id) => id !== adminGroupId);
  return clients.length === 1 ? clients[0]! : null;
}

const clean = (value: unknown): ProjectFilter => {
  if (!value || typeof value !== 'object') return {};
  const { project, event } = value as Record<string, unknown>;
  if (typeof project !== 'string' || project === '') return {};
  return typeof event === 'string' && event !== '' && project !== 'none'
    ? { project, event }
    : { project };
};

export type FinanceProjectState = {
  /** The client whose projects the pills list; null: no filter on this view. */
  groupId: string | null;
  /** Whether the Event pill shows (a client's tab only). */
  events: boolean;
  /** What the queries send: empty without a client. */
  value: ProjectFilter;
  set: (next: ProjectFilter) => void;
};

export function useFinanceProjectFilter(card: string, view: FinanceView): FinanceProjectState {
  const userId = useSession()?.id ?? null;
  const groups = useQuery({ ...groupsQuery, enabled: view.kind === 'all' }).data;
  const adminGroupId = groups?.find((g) => g.kind === 'admin')?.id ?? null;
  const groupId = projectFilterGroup(view, adminGroupId);
  const events = view.kind === 'group';
  const key =
    userId === null || groupId === null
      ? null
      : rememberedFiltersKey(userId, `finance.${card}.project.${groupId}`);
  const [state, setState] = useState<{ key: string | null; value: ProjectFilter }>(() => ({
    key,
    value: key ? clean(readRemembered(key)) : {},
  }));
  let current = state.value;
  if (state.key !== key) {
    current = key ? clean(readRemembered(key)) : {};
    setState({ key, value: current });
  }
  const value = groupId === null ? {} : events ? current : clean({ project: current.project });
  const set = (next: ProjectFilter) => {
    const cleaned = clean(next);
    setState({ key, value: cleaned });
    if (key) writeRemembered(key, cleaned.project ? cleaned : null);
  };
  return { groupId, events, value, set };
}

/** The pills, in the card's filter row; nothing on a view without one client. */
export function FinanceProjectPills({ state }: { state: FinanceProjectState }) {
  const { t } = useTranslation();
  if (state.groupId === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="finance-project-filter">
      <ProjectFilterPills
        groupId={state.groupId}
        value={state.value}
        onChange={state.set}
        eventPill={state.events}
        labels={{
          project: (name) => t('financeLog.projects.project', { name }),
          event: (name) => t('financeLog.projects.event', { name }),
          any: t('financeLog.projects.any'),
          noProject: t('financeLog.projects.noProject'),
          noEvent: t('financeLog.projects.noEvent'),
          empty: t('financeLog.projects.noProjects'),
        }}
      />
    </div>
  );
}
