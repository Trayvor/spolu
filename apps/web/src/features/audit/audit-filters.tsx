import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Admin, GroupSummary } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { AuditSearch } from './search';

/** The kinds of record in the select (spec §4.3); finance ones only for the finance right. */
const GENERAL_TYPES = [
  'group',
  'membership',
  'manager',
  'admin',
  'task',
  'bucket',
  'ticket',
  'knowledge_item',
  'knowledge_folder',
  'project',
  'project_event',
  'mcp_token',
  'oauth_connection',
  'passkey',
  'bulk_campaign',
  'ticket_rating',
  'weekly_summary',
  'weekly_summary_setting',
] as const;
const FINANCE_TYPES = ['finance_item', 'finance_folder', 'time_entry', 'rate', 'finance_access'];

export type FilterChange = (change: Partial<AuditSearch>) => void;

/**
 * The page's filters, one row on wide screens and stacked in the phone sheet: kind of record,
 * client (one), author (the admins, eGrant, the system, AI), and the two days. Each change
 * writes the URL; the one-record filter is the page's chip, set from a row or a link.
 */
export function AuditFilters({
  search,
  onChange,
  finance,
  groups,
  admins,
  stacked = false,
}: {
  search: AuditSearch;
  onChange: FilterChange;
  finance: boolean;
  groups: GroupSummary[];
  admins: Admin[];
  stacked?: boolean;
}) {
  const { t } = useTranslation();
  const ids = { type: useId(), client: useId(), author: useId(), from: useId(), to: useId() };
  const types = finance ? [...GENERAL_TYPES, ...FINANCE_TYPES] : [...GENERAL_TYPES];
  // An author chosen from a row (a client, a token) is not in the list: it stays as an option.
  const listed =
    !search.actor ||
    search.actor.startsWith('kind:') ||
    admins.some((a) => search.actor === `user:${a.id}`);
  const field = stacked ? 'flex flex-col gap-1.5' : 'flex flex-col gap-1';
  const select = stacked ? 'w-full' : 'min-w-0 w-full sm:w-auto';
  return (
    <div className={stacked ? 'flex flex-col gap-4' : 'flex flex-wrap items-end gap-x-3 gap-y-3'}>
      <div className={field}>
        <Label htmlFor={ids.type} className="text-micro text-muted-foreground">
          {t('audit.filters.type')}
        </Label>
        <Select
          id={ids.type}
          containerClassName={select}
          value={search.entityType ?? ''}
          onChange={(e) =>
            onChange({
              entityType: e.target.value || undefined,
              entityId: undefined,
              label: undefined,
            })
          }
        >
          <option value="">{t('audit.filters.all')}</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {t(`audit.types.${type}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className={field}>
        <Label htmlFor={ids.client} className="text-micro text-muted-foreground">
          {t('audit.filters.client')}
        </Label>
        <Select
          id={ids.client}
          containerClassName={select}
          value={search.group ?? ''}
          onChange={(e) => onChange({ group: e.target.value || undefined })}
        >
          <option value="">{t('audit.filters.allClients')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>
      <div className={field}>
        <Label htmlFor={ids.author} className="text-micro text-muted-foreground">
          {t('audit.filters.author')}
        </Label>
        <Select
          id={ids.author}
          containerClassName={select}
          value={search.actor ?? ''}
          onChange={(e) => onChange({ actor: e.target.value || undefined, label: undefined })}
        >
          <option value="">{t('audit.filters.allAuthors')}</option>
          {!listed && search.actor && (
            <option value={search.actor}>{search.label ?? search.actor}</option>
          )}
          <optgroup label={t('audit.filters.admins')}>
            {admins.map((a) => (
              <option key={a.id} value={`user:${a.id}`}>
                {a.name || a.email}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('audit.filters.others')}>
            <option value="kind:egrant">{t('audit.authors.egrant')}</option>
            <option value="kind:system">{t('audit.authors.system')}</option>
            <option value="kind:mcp">{t('audit.authors.mcpAny')}</option>
          </optgroup>
        </Select>
      </div>
      <div className={field}>
        <Label htmlFor={ids.from} className="text-micro text-muted-foreground">
          {t('audit.filters.from')}
        </Label>
        <Input
          id={ids.from}
          type="date"
          value={search.from ?? ''}
          max={search.to}
          onChange={(e) => onChange({ from: e.target.value || undefined })}
        />
      </div>
      <div className={field}>
        <Label htmlFor={ids.to} className="text-micro text-muted-foreground">
          {t('audit.filters.to')}
        </Label>
        <Input
          id={ids.to}
          type="date"
          value={search.to ?? ''}
          min={search.from}
          onChange={(e) => onChange({ to: e.target.value || undefined })}
        />
      </div>
    </div>
  );
}

/** How many filters are set (the phone button's count); the one record counts too. */
export function activeFilterCount(search: AuditSearch): number {
  return [search.entityType, search.group, search.actor, search.from, search.to].filter(Boolean)
    .length;
}

export function ClearFilters({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="link" size="sm" className="px-0" onClick={onClear}>
      {t('audit.filters.clear')}
    </Button>
  );
}
