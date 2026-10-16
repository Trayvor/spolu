import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TaskPerson } from '@spolu/shared';
import { ClientFilter, type ClientOption } from '@/components/client-filter';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { groupsQuery } from '@/features/groups/api';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import type { useGlobalSearch } from './use-global-search';

type Search = ReturnType<typeof useGlobalSearch>;

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const DUE = ['any', 'overdue', 'week', 'none'] as const;

/** `clients=all`: every client, now and later, without listing the ids. */
const ALL = 'all';

/** Every filter as a pill (a dropdown, a toggle, the search field and "Show completed"). */
function FilterControls({ board, people }: { board: Search; people: TaskPerson[] }) {
  const { t } = useTranslation();
  const groups = useQuery(groupsQuery).data;
  const options = useMemo<ClientOption[]>(
    () =>
      (groups ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        logoUrl: group.hasLogo
          ? `/api/groups/${encodeURIComponent(group.id)}/logo?v=${encodeURIComponent(group.updatedAt)}`
          : null,
      })),
    [groups],
  );
  const managedIds = useMemo(
    () => (groups ? groups.filter((g) => g.managedByMe).map((g) => g.id) : null),
    [groups],
  );
  const { search } = board;
  const assignee = search.assignee ?? 'anyone';
  const fixed: Record<string, string> = {
    me: t('adminHome.board.assignee.me'),
    anyone: t('adminHome.board.assignee.anyone'),
    none: t('adminHome.board.assignee.none'),
  };
  const assigneeName = fixed[assignee] ?? people.find((p) => p.id === assignee)?.name ?? '…';
  const due = search.due ?? 'any';
  const pressed = 'bg-primary text-primary-foreground hover:bg-ink-hover';

  return (
    <>
      <ClientFilter
        groups={options}
        managedIds={managedIds}
        value={board.clients?.[0] === ALL ? options.map((o) => o.id) : board.clients}
        onChange={(next) =>
          board.setClients(
            next !== null && options.length > 0 && options.every((o) => next.includes(o.id))
              ? [ALL]
              : next,
          )
        }
        disabled={groups === undefined}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className={cn(assignee !== 'anyone' && pressed)}>
            {t('adminHome.board.assignee.label', { name: assigneeName })}
            <Chevron />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          <DropdownMenuRadioGroup
            value={assignee}
            onValueChange={(value) =>
              board.set((s) => {
                if (value === 'anyone') delete s.assignee;
                else s.assignee = value;
              })
            }
          >
            {(['me', 'anyone', 'none'] as const).map((key) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {fixed[key]}
              </DropdownMenuRadioItem>
            ))}
            {people.length > 0 && <DropdownMenuSeparator />}
            {people.map((person) => (
              <DropdownMenuRadioItem key={person.id} value={person.id}>
                {person.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="secondary"
        size="sm"
        aria-pressed={search.urgent === 1}
        className={cn(search.urgent === 1 && pressed)}
        onClick={() =>
          board.set((s) => {
            if (s.urgent) delete s.urgent;
            else s.urgent = 1;
          })
        }
      >
        {t('adminHome.board.urgent')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className={cn(due !== 'any' && pressed)}>
            {t('adminHome.board.due.label', { name: t(`adminHome.board.due.${due}`) })}
            <Chevron />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={due}
            onValueChange={(value) =>
              board.set((s) => {
                if (value === 'any') delete s.due;
                else s.due = value;
              })
            }
          >
            {DUE.map((key) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {t(`adminHome.board.due.${key}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <label className="relative w-full min-[641px]:w-[240px]">
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">
          <SearchIcon />
        </span>
        <Input
          type="search"
          value={board.text}
          onChange={(event) => board.changeText(event.target.value)}
          placeholder={t('adminHome.board.search')}
          maxLength={100}
          aria-label={t('adminHome.board.search')}
          className="py-1.5 pl-10 text-tiny"
        />
      </label>
      <label className="inline-flex h-8 items-center gap-2 px-1 text-tiny font-semibold">
        <input
          type="checkbox"
          className="size-4 accent-foreground"
          checked={search.completed === 1}
          onChange={(event) =>
            board.set((s) => {
              if (event.target.checked) s.completed = 1;
              else delete s.completed;
            })
          }
        />
        {t('adminHome.board.completed')}
      </label>
      {board.changed > 0 && (
        <Button variant="ghost" size="sm" onClick={board.clear}>
          {t('adminHome.board.clear')}
        </Button>
      )}
    </>
  );
}

/**
 * The global board's filter row. It wraps on narrow screens; under 641 px it collapses into one
 * "Filters (n)" pill that opens a sheet with the same controls.
 */
export function BoardFilters({ board, people }: { board: Search; people: TaskPerson[] }) {
  const { t } = useTranslation();
  const desktop = useMediaQuery('(min-width: 641px)');
  const [open, setOpen] = useState(false);

  if (desktop) {
    return (
      <div
        role="group"
        aria-label={t('adminHome.board.filtersLabel')}
        className="flex flex-wrap items-center gap-2"
      >
        <FilterControls board={board} people={people} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t('adminHome.board.filters', { count: board.changed })}
      </Button>
      {board.changed > 0 && (
        <Button variant="ghost" size="sm" onClick={board.clear}>
          {t('adminHome.board.clear')}
        </Button>
      )}
      {open && (
        <SheetDialog onEscape={() => setOpen(false)}>
          <div className="flex items-center justify-between border-b-2 border-border px-4 py-2">
            <SheetDialogTitle className="text-body font-semibold">
              {t('adminHome.board.filtersTitle')}
            </SheetDialogTitle>
            <Button size="sm" onClick={() => setOpen(false)}>
              {t('adminHome.board.close')}
            </Button>
          </div>
          <div
            role="group"
            aria-label={t('adminHome.board.filtersLabel')}
            className="flex flex-wrap items-center gap-2 overflow-y-auto p-4"
          >
            <FilterControls board={board} people={people} />
          </div>
        </SheetDialog>
      )}
    </div>
  );
}
