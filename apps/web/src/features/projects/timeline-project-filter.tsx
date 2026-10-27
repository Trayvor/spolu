import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from 'radix-ui';
import type { ProjectPickerItem } from '@spolu/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { POPOVER } from '@/components/ui/popover';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { useMediaQuery } from '@/lib/use-media-query';
import { ProjectDot } from './project-dot';
import {
  ALL_PROJECTS,
  filterSections,
  onlyProject,
  shownIds,
  toggleProject,
  type TimelineFilter,
} from './timeline-filter';

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * The timeline's project filter (owner request 2026-10-22): a secondary pill that opens a
 * popover from 641 px and a `SheetDialog` below (as the client filter), with "All projects", a
 * checkbox and an "Only this" button per project, and the archived projects in their own
 * section. Test projects (ADR 0073) have a section of their own too, until "Show test
 * projects" (`showTest`, `?test=1`) makes them ordinary active ones. Every change calls
 * `onChange` at once; the rules are in `timeline-filter.ts`.
 */
export function TimelineProjectFilter({
  projects,
  value,
  onChange,
  showTest,
  onShowTestChange,
}: {
  projects: ProjectPickerItem[];
  value: TimelineFilter;
  onChange: (next: TimelineFilter) => void;
  showTest: boolean;
  onShowTestChange: (show: boolean) => void;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`projects.timeline.filter.${key}`, options);
  const desktop = useMediaQuery('(min-width: 641px)');
  const [open, setOpen] = useState(false);
  const { active, test, archived, hasTest } = filterSections(projects, showTest);
  const activeIds = active.map((p) => p.id);
  // Shown only when chosen: the hidden test projects and the archived ones.
  const archivedIds = [...test, ...archived].map((p) => p.id);
  const shown = shownIds(value, activeIds, archivedIds);
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? '';

  // Ids of projects that no longer exist (an old link, a stored choice) are ignored.
  const known = value.kind === 'all' ? [] : value.ids.filter((id) => nameOf(id) !== '');
  const pill =
    value.kind === 'all' || (value.kind === 'except' && known.length === 0)
      ? t('projects.timeline.allProjects')
      : value.kind === 'except'
        ? known.length === 1
          ? k('allExceptOne', { name: nameOf(known[0]!) })
          : k('allExcept', { count: known.length })
        : shown.size === 1
          ? nameOf([...shown][0]!)
          : k('selected', { count: shown.size });

  const panel = (
    <Panel
      active={active}
      test={test}
      archived={archived}
      showTest={hasTest ? showTest : null}
      onShowTest={onShowTestChange}
      shown={shown}
      all={value.kind === 'all'}
      onAll={() => onChange(ALL_PROJECTS)}
      onToggle={(id) => onChange(toggleProject(value, id, activeIds, archivedIds))}
      onOnly={(id) => onChange(onlyProject(id))}
      onDone={() => setOpen(false)}
    />
  );
  const trigger = (
    <Button
      variant="secondary"
      size="sm"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`${k('label')}: ${pill}`}
      onClick={desktop ? undefined : () => setOpen(true)}
      className="max-w-64"
    >
      <span className="min-w-0 truncate">{pill}</span>
      <ChevronIcon />
    </Button>
  );

  if (desktop) {
    return (
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            aria-label={k('label')}
            className={`z-50 flex max-h-[min(520px,var(--radix-popover-content-available-height))] w-[340px] max-w-[calc(100vw-24px)] origin-(--radix-popover-content-transform-origin) flex-col p-2 outline-none data-[state=closed]:animate-menu-out data-[state=open]:animate-menu-in ${POPOVER}`}
          >
            {panel}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }
  return (
    <>
      {trigger}
      {open && (
        <SheetDialog onEscape={() => setOpen(false)}>
          <div className="flex min-h-0 flex-1 flex-col p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            <SheetDialogTitle className="pb-3 text-medium font-semibold">
              {k('label')}
            </SheetDialogTitle>
            {panel}
          </div>
        </SheetDialog>
      )}
    </>
  );
}

const ROW =
  'flex min-h-10 items-center gap-3 rounded-lg px-3 text-button font-medium transition-colors duration-(--duration-fast) hover:bg-accent touch:min-h-11';

function Panel({
  active,
  test,
  archived,
  showTest,
  onShowTest,
  shown,
  all,
  onAll,
  onToggle,
  onOnly,
  onDone,
}: {
  active: ProjectPickerItem[];
  test: ProjectPickerItem[];
  archived: ProjectPickerItem[];
  /** "Show test projects", or null when the client has none. */
  showTest: boolean | null;
  onShowTest: (show: boolean) => void;
  shown: Set<string>;
  all: boolean;
  onAll: () => void;
  onToggle: (id: string) => void;
  onOnly: (id: string) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`projects.timeline.filter.${key}`, options);
  const allBox = useRef<HTMLInputElement>(null);
  // "All projects" is half ticked while some, but not all, are shown.
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = !all;
  }, [all]);
  const archivedTitle = useId();
  const testTitle = useId();
  const row = (p: ProjectPickerItem) => {
    const checked = shown.has(p.id);
    return (
      <div key={p.id} className={ROW}>
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 self-stretch">
          <input
            type="checkbox"
            checked={checked}
            // The last shown project stays: the timeline never shows none.
            disabled={checked && shown.size === 1}
            onChange={() => onToggle(p.id)}
            className="size-5 shrink-0 accent-foreground"
          />
          <ProjectDot color={p.color} />
          <span className="min-w-0 truncate">{p.name}</span>
          {p.isTest && <Badge variant="secondary">{t('projects.testBadge')}</Badge>}
        </label>
        <Button
          variant="link"
          size="sm"
          className="shrink-0 px-1 text-tiny"
          aria-label={k('onlyThisNamed', { name: p.name })}
          onClick={() => onOnly(p.id)}
        >
          {k('onlyThis')}
        </Button>
      </div>
    );
  };
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <label className={`${ROW} cursor-pointer font-semibold`}>
          <input
            ref={allBox}
            type="checkbox"
            checked={all}
            onChange={onAll}
            className="size-5 shrink-0 accent-foreground"
          />
          {t('projects.timeline.allProjects')}
        </label>
        {active.map(row)}
        {test.length > 0 && (
          <div role="group" aria-labelledby={testTitle} className="flex flex-col">
            <p
              id={testTitle}
              className="px-3 pt-2 pb-1 text-micro font-semibold text-muted-foreground"
            >
              {k('testSection')}
            </p>
            {test.map(row)}
          </div>
        )}
        {archived.length > 0 && (
          <div role="group" aria-labelledby={archivedTitle} className="flex flex-col">
            <p
              id={archivedTitle}
              className="px-3 pt-2 pb-1 text-micro font-semibold text-muted-foreground"
            >
              {t('projects.card.archived')}
            </p>
            {archived.map(row)}
          </div>
        )}
      </div>
      {showTest !== null && (
        <div className="mt-1 border-t border-border pt-1">
          <label className={`${ROW} cursor-pointer`}>
            <input
              type="checkbox"
              checked={showTest}
              onChange={(event) => onShowTest(event.target.checked)}
              className="size-5 shrink-0 accent-foreground"
            />
            {k('showTest')}
          </label>
        </div>
      )}
      <div className="flex justify-end pt-2">
        <Button size="sm" onClick={onDone}>
          {k('done')}
        </Button>
      </div>
    </>
  );
}
