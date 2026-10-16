import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { BulkAudience, BulkAudienceRole, BulkPerson } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { adminsQuery } from '@/features/admins/api';
import { groupsQuery } from '@/features/groups/api';
import { audienceCountQuery, peopleLookupQuery } from './api';
import { useDebounced } from './parts';
import { PersonPicker } from './person-picker';
import { RecipientsDialog } from './recipients-dialog';

const ROLES: BulkAudienceRole[] = ['client', 'ziadatel', 'admin'];

/** Lower case without diacritics, so "lu" finds "Lúčky". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const toggle = (list: string[], id: string, on: boolean) =>
  on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id);

function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-3 text-button max-[640px]:min-h-11">
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-foreground"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

function Fieldset({
  legend,
  hint,
  children,
}: {
  legend: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-tiny font-semibold">{legend}</legend>
      {hint && <p className="-mt-1 mb-1 text-micro text-muted-foreground">{hint}</p>}
      {children}
    </fieldset>
  );
}

/**
 * Who gets the email (spec §2): roles, client groups (none = every group), the groups of chosen
 * managers, people added or left out by hand, with the live count 300 ms after the last change
 * and "Show recipients".
 */
export function AudienceBuilder({
  audience,
  onChange,
}: {
  audience: BulkAudience;
  onChange: (audience: BulkAudience) => void;
}) {
  const { t } = useTranslation();
  const groups = useQuery(groupsQuery);
  const admins = useQuery(adminsQuery);
  const [groupFilter, setGroupFilter] = useState('');
  const [showRecipients, setShowRecipients] = useState(false);

  // People picked by hand in a saved draft: their names, fetched once.
  const [initialIds] = useState(() => [...audience.includeUserIds, ...audience.excludeUserIds]);
  const lookup = useQuery({ ...peopleLookupQuery(initialIds), enabled: initialIds.length > 0 });
  const [found, setFound] = useState<Map<string, BulkPerson>>(() => new Map());
  const known = useMemo(() => {
    const map = new Map(found);
    for (const p of lookup.data ?? []) if (!map.has(p.id)) map.set(p.id, p);
    return map;
  }, [found, lookup.data]);
  const remember = (person: BulkPerson) => setFound((m) => new Map(m).set(person.id, person));

  const serialized = useDebounced(JSON.stringify(audience), 300);
  const debounced = useMemo(() => JSON.parse(serialized) as BulkAudience, [serialized]);
  const count = useQuery({ ...audienceCountQuery(debounced), placeholderData: (prev) => prev });

  const set = (patch: Partial<BulkAudience>) => onChange({ ...audience, ...patch });
  const shownGroups = (groups.data ?? []).filter((g) =>
    fold(g.name).includes(fold(groupFilter.trim())),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 min-[641px]:grid-cols-2">
        <Fieldset legend={t('bulkEmail.audience.roles')} hint={t('bulkEmail.audience.rolesHint')}>
          {ROLES.map((role) => (
            <Checkbox
              key={role}
              checked={audience.roles.includes(role)}
              onChange={(on) =>
                set({
                  roles: ROLES.filter((r) => (r === role ? on : audience.roles.includes(r))),
                })
              }
            >
              {t(`bulkEmail.audience.role.${role}`)}
            </Checkbox>
          ))}
        </Fieldset>

        <Fieldset
          legend={t('bulkEmail.audience.managers')}
          hint={t('bulkEmail.audience.managersHint')}
        >
          <div className="max-h-[200px] overflow-y-auto">
            {(admins.data ?? []).map((admin) => (
              <Checkbox
                key={admin.id}
                checked={audience.managerIds.includes(admin.id)}
                onChange={(on) => set({ managerIds: toggle(audience.managerIds, admin.id, on) })}
              >
                {admin.name}
              </Checkbox>
            ))}
          </div>
        </Fieldset>
      </div>

      <Fieldset legend={t('bulkEmail.audience.groups')} hint={t('bulkEmail.audience.groupsHint')}>
        <Input
          type="search"
          aria-label={t('bulkEmail.audience.groupSearch')}
          placeholder={t('bulkEmail.audience.groupSearch')}
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
        />
        <div className="max-h-[240px] overflow-y-auto rounded-md border-2 border-border bg-card px-3 py-1">
          {shownGroups.map((group) => (
            <Checkbox
              key={group.id}
              checked={audience.groupIds.includes(group.id)}
              onChange={(on) => set({ groupIds: toggle(audience.groupIds, group.id, on) })}
            >
              {group.name}
            </Checkbox>
          ))}
          {groups.isSuccess && shownGroups.length === 0 && (
            <p className="py-2 text-micro text-muted-foreground">
              {t('bulkEmail.audience.groupsNone')}
            </p>
          )}
        </div>
        {audience.groupIds.length > 0 && (
          <p className="text-micro text-muted-foreground">
            {t('bulkEmail.audience.groupsChosen', { count: audience.groupIds.length })}
          </p>
        )}
      </Fieldset>

      <div className="grid gap-6 min-[641px]:grid-cols-2">
        <PersonPicker
          label={t('bulkEmail.audience.include')}
          ids={audience.includeUserIds}
          known={known}
          onAdd={(p) => {
            remember(p);
            set({
              includeUserIds: toggle(audience.includeUserIds, p.id, true),
              excludeUserIds: toggle(audience.excludeUserIds, p.id, false),
            });
          }}
          onRemove={(id) => set({ includeUserIds: toggle(audience.includeUserIds, id, false) })}
        />
        <PersonPicker
          label={t('bulkEmail.audience.exclude')}
          ids={audience.excludeUserIds}
          known={known}
          onAdd={(p) => {
            remember(p);
            set({
              excludeUserIds: toggle(audience.excludeUserIds, p.id, true),
              includeUserIds: toggle(audience.includeUserIds, p.id, false),
            });
          }}
          onRemove={(id) => set({ excludeUserIds: toggle(audience.excludeUserIds, id, false) })}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-muted p-4 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between">
        <div role="status" className="flex flex-col gap-1">
          {count.data ? (
            <>
              <span className="text-body font-semibold">
                {t('bulkEmail.audience.count', { count: count.data.count })}
              </span>
              {(count.data.leftOut.unsubscribed > 0 || count.data.leftOut.disabled > 0) && (
                <span className="text-micro text-muted-foreground">
                  {t('bulkEmail.audience.leftOut', count.data.leftOut)}
                </span>
              )}
            </>
          ) : (
            <span className="text-button text-muted-foreground">
              {count.isError ? t('errors.generic') : t('bulkEmail.audience.counting')}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={!count.data || count.data.count === 0}
          onClick={() => setShowRecipients(true)}
        >
          {t('bulkEmail.audience.show')}
        </Button>
      </div>
      {showRecipients && (
        <RecipientsDialog audience={debounced} onClose={() => setShowRecipients(false)} />
      )}
    </div>
  );
}
