import { useId, useRef, useState } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  TICKET_AREA_LIMITS,
  TicketAreaRulesSchema,
  ticketAreaKey,
  type TicketAreaRule,
  type TicketAreaRuleInput,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PanelHeader } from '@/components/ui/panel-header';
import { Select } from '@/components/ui/select';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { apiGet, apiSend } from '@/lib/api';

const enc = encodeURIComponent;

/** A client's area → riešiteľ table (2026-10-21): admins and, from 2026-10-22, its clients. */
export const areaRulesQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['tickets', 'areaRules', groupId],
    queryFn: () => apiGet(`/groups/${enc(groupId)}/ticket-areas`, TicketAreaRulesSchema),
  });

type Row = { key: number; area: string; userId: string };

let nextKey = 1;
const toRow = (rule: TicketAreaRule): Row => ({
  key: nextKey++,
  area: rule.area,
  userId: rule.user.id,
});

/**
 * "Automatic assignees" of one client (2026-10-21): a table of question area → riešiteľ (an admin
 * or, from 2026-10-22, one of the client's people), edited in place (add, change, remove rows)
 * and saved whole. A new ticket of the client whose area matches a row gets that person as an
 * assignee. Rows eGrant sent are listed read-only under it: a save keeps them, and eGrant's sync
 * replaces only those.
 */
export function AreaRulesDialog({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const uid = useId();
  const addRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const rules = useQuery(areaRulesQuery(groupId));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [invalid, setInvalid] = useState(false);
  const current = rows ?? rules.data?.rules.filter((r) => r.source === 'help').map(toRow) ?? [];
  const fromEgrant = rules.data?.rules.filter((r) => r.source === 'egrant') ?? [];
  const candidates = rules.data?.candidates ?? [];
  const team = candidates.filter((c) => c.isAdmin);
  const people = candidates.filter((c) => !c.isAdmin);
  const save = useMutation({
    mutationFn: (body: { rules: TicketAreaRuleInput[] }) =>
      apiSend('PUT', `/groups/${enc(groupId)}/ticket-areas`, body, TicketAreaRulesSchema),
    onSuccess: (answer) => {
      queryClient.setQueryData(areaRulesQuery(groupId).queryKey, answer);
      onClose();
    },
  });

  const edit = (next: Row[]) => {
    setRows(next);
    setInvalid(false);
  };
  const change = (key: number, patch: Partial<Row>) =>
    edit(current.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = () => {
    const filled = current.filter((r) => r.area.trim() || r.userId);
    if (filled.some((r) => !ticketAreaKey(r.area) || !r.userId)) {
      setInvalid(true);
      return;
    }
    save.mutate({ rules: filled.map((r) => ({ area: r.area.trim(), userId: r.userId })) });
  };

  const loading = rules.isPending;
  const full = current.length >= TICKET_AREA_LIMITS.rows;

  return (
    <SheetDialog onEscape={onClose} initialFocus={addRef} testId="area-rules">
      <PanelHeader onClose={onClose} compactBelow={641} backLabel={t('ticketAreas.back')}>
        <span />
      </PanelHeader>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 min-[641px]:px-6 min-[641px]:py-5">
          <SheetDialogTitle className="text-medium font-semibold">
            {t('ticketAreas.title')}
          </SheetDialogTitle>
          <p className="max-w-[60ch] text-tiny text-muted-foreground">{t('ticketAreas.intro')}</p>
          {loading ? (
            <p role="status" className="text-tiny text-muted-foreground">
              {t('ticketAreas.loading')}
            </p>
          ) : rules.isError ? (
            <p role="alert" className="text-tiny text-error-ink">
              {t('ticketAreas.loadFailed')}
            </p>
          ) : (
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">{t('ticketAreas.title')}</caption>
              <thead className="max-[640px]:sr-only">
                <tr className="text-micro font-semibold text-muted-foreground">
                  <th scope="col" className="pb-2 font-semibold">
                    {t('ticketAreas.area')}
                  </th>
                  <th scope="col" className="pb-2 pl-3 font-semibold">
                    {t('ticketAreas.admin')}
                  </th>
                  <th scope="col" className="pb-2">
                    <span className="sr-only">{t('ticketAreas.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {current.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-tiny text-muted-foreground">
                      {t('ticketAreas.empty')}
                    </td>
                  </tr>
                )}
                {current.map((row, index) => {
                  const n = index + 1;
                  const gone = row.userId !== '' && !candidates.some((c) => c.id === row.userId);
                  return (
                    <tr
                      key={row.key}
                      className="border-t-2 border-border max-[640px]:grid max-[640px]:grid-cols-[1fr_auto] max-[640px]:gap-2 max-[640px]:py-3"
                    >
                      <td className="py-2 align-top max-[640px]:col-span-2 max-[640px]:py-0">
                        <Input
                          aria-label={t('ticketAreas.areaOf', { n })}
                          value={row.area}
                          maxLength={TICKET_AREA_LIMITS.area}
                          placeholder={t('ticketAreas.areaPlaceholder')}
                          aria-invalid={invalid && !ticketAreaKey(row.area) ? true : undefined}
                          onChange={(e) => change(row.key, { area: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pl-3 align-top max-[640px]:py-0 max-[640px]:pl-0">
                        <Select
                          aria-label={t('ticketAreas.adminOf', { n })}
                          containerClassName="w-full"
                          value={row.userId}
                          aria-invalid={invalid && !row.userId ? true : undefined}
                          onChange={(e) => change(row.key, { userId: e.target.value })}
                        >
                          <option value="">{t('ticketAreas.chooseAdmin')}</option>
                          {gone && (
                            <option value={row.userId}>
                              {t('ticketAreas.formerAdmin', {
                                name:
                                  rules.data?.rules.find((r) => r.user.id === row.userId)?.user
                                    .name ?? '',
                              })}
                            </option>
                          )}
                          <optgroup label={t('ticketAreas.team')}>
                            {team.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </optgroup>
                          {people.length > 0 && (
                            <optgroup label={t('ticketAreas.clientPeople')}>
                              {people.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </Select>
                      </td>
                      <td className="py-2 pl-2 text-right align-top max-[640px]:col-start-2 max-[640px]:row-start-2 max-[640px]:py-0">
                        <Button
                          type="button"
                          variant="ghost"
                          className="min-h-[52px]"
                          onClick={() => edit(current.filter((r) => r.key !== row.key))}
                        >
                          {t('ticketAreas.remove')}
                          <span className="sr-only"> {t('ticketAreas.rowN', { n })}</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <Button
            ref={addRef}
            type="button"
            variant="secondary"
            className="self-start"
            disabled={loading || full}
            onClick={() => edit([...current, { key: nextKey++, area: '', userId: '' }])}
          >
            {t('ticketAreas.add')}
          </Button>
          {fromEgrant.length > 0 && (
            <section aria-labelledby={`${uid}-egrant-title`} className="flex flex-col gap-2">
              <h3 id={`${uid}-egrant-title`} className="text-button font-semibold">
                {t('ticketAreas.egrantTitle')}
              </h3>
              <ul role="list" className="flex flex-col">
                {fromEgrant.map((rule) => (
                  <li
                    key={`${rule.area}:${rule.user.id}`}
                    className="flex flex-wrap gap-x-3 border-t-2 border-border py-2 text-tiny"
                  >
                    <span className="font-medium">{rule.area}</span>
                    <span className="text-muted-foreground">→ {rule.user.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p id={`${uid}-egrant`} className="max-w-[60ch] text-micro text-muted-foreground">
            {t('ticketAreas.egrantHint')}
          </p>
        </div>
        <footer className="flex flex-col gap-2 border-t-2 border-border px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] min-[641px]:px-6">
          {invalid && (
            <p role="alert" className="text-tiny text-error-ink">
              {t('ticketAreas.incomplete')}
            </p>
          )}
          {save.isError && (
            <p role="alert" className="text-tiny text-error-ink">
              {t('ticketAreas.saveFailed')}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              {t('ticketAreas.cancel')}
            </Button>
            <Button type="submit" size="lg" disabled={loading || save.isPending}>
              {t('ticketAreas.save')}
            </Button>
          </div>
        </footer>
      </form>
    </SheetDialog>
  );
}

export default AreaRulesDialog;
