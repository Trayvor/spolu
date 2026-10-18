import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ProjectFilterPills } from '@/features/projects/project-filter';
import { useMediaQuery } from '@/lib/use-media-query';
import type { BoardSearch } from './board-search';

/**
 * The group board's filter row (Phase 33 part P2, decision 19): the Project pill and, with a
 * project chosen, the Event pill, then "Clear filters" while one is set. Under 641 px it folds
 * into one "Filters (n)" pill that shows the same pills below it.
 */
export function BoardFilterRow({
  groupId,
  value,
  onChange,
}: {
  groupId: string;
  value: BoardSearch;
  onChange: (next: BoardSearch) => void;
}) {
  const { t } = useTranslation();
  // Phones fold the pills; without `matchMedia` (tests) the row shows them all.
  const desktop = !useMediaQuery('(max-width: 640px)');
  const [open, setOpen] = useState(false);
  const count = (value.project !== undefined ? 1 : 0) + (value.event !== undefined ? 1 : 0);

  const pills = (
    <ProjectFilterPills
      groupId={groupId}
      value={value}
      onChange={onChange}
      labels={{
        project: (name) => t('tasks.filters.project', { name }),
        event: (name) => t('tasks.filters.event', { name }),
        any: t('tasks.filters.any'),
        noProject: t('tasks.filters.noProject'),
        noEvent: t('tasks.filters.noEvent'),
        empty: t('tasks.filters.noProjects'),
      }}
    />
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
    </div>
  );
}
