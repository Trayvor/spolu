import type { ReactNode } from 'react';
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
import { cn } from '@/lib/utils';
import type { TicketFilter } from './api';
import { ChevronDown } from './icons';

const STATUSES = ['open', 'resolved', 'all'] as const;
const ASSIGNEES = ['anyone', 'me', 'none'] as const;

// The knowledge tab's type pills: 32 px, a 44 px tap area, filled ink when chosen.
const pill =
  "relative inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-tiny font-semibold transition-colors duration-(--duration-fast) before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']";
const pillOff = 'bg-secondary text-secondary-foreground hover:bg-surface-3';
const pillOn = 'bg-primary text-primary-foreground';

/**
 * The filters of every ticket list: the status (Open = New and In progress, the default;
 * Resolved; All) as three pills, the question area as a menu of the areas seen in the list, the
 * riešiteľ (anyone, me, nobody) as a menu. `children` go first in the bar (the global view's
 * client filter).
 * "Clear filters" shows while any filter is off its default (filters are remembered per list).
 */
export function TicketFilters({
  filter,
  onChange,
  areas,
  children,
}: {
  filter: TicketFilter;
  onChange: (next: TicketFilter) => void;
  areas: string[];
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<TicketFilter>) => onChange({ ...filter, ...patch });
  const options = filter.area && !areas.includes(filter.area) ? [filter.area, ...areas] : areas;
  const changed =
    filter.status !== 'open' ||
    !!filter.area ||
    !!filter.assignee ||
    (filter.clients !== null && filter.clients !== undefined) ||
    !!filter.noClient;

  return (
    <div
      role="group"
      aria-label={t('tickets.filters.label')}
      className="flex flex-wrap items-center gap-2"
    >
      {children}
      <div role="group" aria-label={t('tickets.filters.status')} className="flex gap-2">
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={filter.status === status}
            className={cn(pill, filter.status === status ? pillOn : pillOff)}
            onClick={() => set({ status })}
          >
            {t(`tickets.filters.${status}`)}
          </button>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(pill, filter.area ? pillOn : pillOff, 'max-w-60')}>
          <span className="truncate">
            {filter.area
              ? t('tickets.filters.areaChosen', { area: filter.area })
              : t('tickets.filters.allAreas')}
          </span>
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 max-w-[min(320px,90vw)] overflow-y-auto"
        >
          <DropdownMenuRadioGroup
            value={filter.area ?? ''}
            onValueChange={(area) => set({ area: area || undefined })}
          >
            <DropdownMenuRadioItem value="">{t('tickets.filters.allAreas')}</DropdownMenuRadioItem>
            {options.length > 0 && <DropdownMenuSeparator />}
            {options.map((area) => (
              <DropdownMenuRadioItem key={area} value={area}>
                <span className="line-clamp-2">{area}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {options.length === 0 && (
            <p className="px-3 py-2 text-micro text-muted-foreground">
              {t('tickets.filters.noAreas')}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(pill, filter.assignee ? pillOn : pillOff)}>
          {t('tickets.filters.assignee', {
            name: t(`tickets.filters.assignees.${filter.assignee ?? 'anyone'}`),
          })}
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={filter.assignee ?? 'anyone'}
            onValueChange={(value) =>
              set({ assignee: value === 'me' || value === 'none' ? value : undefined })
            }
          >
            {ASSIGNEES.map((key) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {t(`tickets.filters.assignees.${key}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {changed && (
        // Back to the defaults; the remembered filters go with them.
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ status: 'open', clients: null })}
        >
          {t('tickets.filters.clear')}
        </Button>
      )}
    </div>
  );
}
