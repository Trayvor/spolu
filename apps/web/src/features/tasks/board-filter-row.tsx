import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { groupPeopleQuery } from '@/features/groups/api';
import { Chevron, filterPillClass, ProjectFilterPills } from '@/features/projects/project-filter';
import { useMediaQuery } from '@/lib/use-media-query';
import type { BoardSearch } from './board-search';

/** The "any" item of a menu: Radix radio items need a value, the URL has none. */
const ANY = '';

/**
 * The Assignee pill (2026-10-19, owner request; the global board's filter): anyone, me, nobody,
 * then the group's people, the same list the task form offers as assignees (so a client sees
 * only whom the group already shows them). The list loads when the menu opens, or at once while
 * a person is chosen (to name them).
 */
function AssigneePill({
  groupId,
  value,
  onChange,
}: {
  groupId: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [wanted, setWanted] = useState(false);
  const chosen = value !== undefined && value !== 'me' && value !== 'none';
  const people = useQuery({ ...groupPeopleQuery(groupId), enabled: wanted || chosen }).data;
  const name =
    value === undefined
      ? t('tasks.filters.assigneeAny')
      : value === 'me'
        ? t('tasks.filters.assigneeMe')
        : value === 'none'
          ? t('tasks.filters.assigneeNone')
          : (people?.find((p) => p.id === value)?.name ?? '…');
  return (
    <DropdownMenu onOpenChange={(open) => open && setWanted(true)}>
      <DropdownMenuTrigger className={filterPillClass(value !== undefined)}>
        <span className="truncate">{t('tasks.filters.assignee', { name })}</span>
        <Chevron />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 max-w-[min(320px,90vw)]">
        <DropdownMenuRadioGroup
          value={value ?? ANY}
          onValueChange={(next) => onChange(next === ANY ? undefined : next)}
        >
          <DropdownMenuRadioItem value={ANY}>
            {t('tasks.filters.assigneeAny')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="me">{t('tasks.filters.assigneeMe')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="none">
            {t('tasks.filters.assigneeNone')}
          </DropdownMenuRadioItem>
          {people && people.length > 0 && <DropdownMenuSeparator />}
          {people?.map((person) => (
            <DropdownMenuRadioItem key={person.id} value={person.id}>
              <span className="line-clamp-2">{person.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The group board's filter row (Phase 33 part P2, decision 19): the Project pill and, with a
 * project chosen, the Event pill, the Assignee pill (2026-10-19), then "Clear filters" while one
 * is set. Under 641 px it folds into one "Filters (n)" pill that shows the same pills below it.
 * `onChange` gets the whole filter: a key left out is cleared.
 */
export function BoardFilterRow({
  groupId,
  value,
  onChange,
  action,
}: {
  groupId: string;
  value: BoardSearch;
  onChange: (next: BoardSearch) => void;
  /** A button at the end of the row (the board's "Generate tasks from text"). */
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  // Phones fold the pills; without `matchMedia` (tests) the row shows them all.
  const desktop = !useMediaQuery('(max-width: 640px)');
  const [open, setOpen] = useState(false);
  const count =
    (value.project !== undefined ? 1 : 0) +
    (value.event !== undefined ? 1 : 0) +
    (value.assignee !== undefined ? 1 : 0);

  const pills = (
    <>
      <ProjectFilterPills
        groupId={groupId}
        value={value}
        // The pills answer the project and event only: the assignee stays.
        onChange={(next) => onChange({ ...next, assignee: value.assignee })}
        labels={{
          project: (name) => t('tasks.filters.project', { name }),
          event: (name) => t('tasks.filters.event', { name }),
          any: t('tasks.filters.any'),
          noProject: t('tasks.filters.noProject'),
          noEvent: t('tasks.filters.noEvent'),
          empty: t('tasks.filters.noProjects'),
        }}
      />
      <AssigneePill
        groupId={groupId}
        value={value.assignee}
        onChange={(assignee) => onChange({ project: value.project, event: value.event, assignee })}
      />
    </>
  );
  const clear = count > 0 && (
    <Button variant="ghost" size="sm" onClick={() => onChange({})}>
      {t('tasks.filters.clear')}
    </Button>
  );

  return (
    <div
      role="group"
      aria-label={t('tasks.filters.label')}
      className="mb-3 flex flex-wrap items-center gap-2"
    >
      {desktop ? (
        pills
      ) : (
        <>
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {t('tasks.filters.toggle', { count })}
          </Button>
          {open && <div className="flex w-full flex-wrap items-center gap-2">{pills}</div>}
        </>
      )}
      {clear}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
