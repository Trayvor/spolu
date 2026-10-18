import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { COST_CURRENCY, parseMoney, type RatesDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { InlineConfirm } from '@/components/ui/inline-confirm';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListSkeleton } from '@/components/ui/skeleton';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import type { FinanceView } from './api';
import { DialogFrame } from './dialog-frame';
import { useFinanceFormat } from './format';
import { ratesQuery, useAddRate, useDeleteRate } from './log-api';
import { currentMonth } from './period';

/**
 * Hourly rates (spec §6.2 step 3, decision 10): every admin with the rate that applies today and
 * "Change"; a new rate applies from the day chosen (default the first of this month; an admin's
 * first rate "from the start"); the history per admin with who set each row, and Delete for a
 * mistaken one. EUR only. Opened from the work log (and from `/finance` in part D).
 */
export function RatesDialog({ view, onClose }: { view: FinanceView; onClose: () => void }) {
  const { t } = useTranslation();
  const query = useQuery(ratesQuery(view));
  return (
    <SheetDialog onEscape={onClose} testId="finance-rates">
      <DialogFrame
        onClose={onClose}
        title={
          <SheetDialogTitle className="text-medium font-semibold">
            {t('financeLog.rates')}
          </SheetDialogTitle>
        }
      >
        <p className="text-tiny text-muted-foreground">{t('financeLog.ratesDialog.hint')}</p>
        {query.isPending ? (
          <div aria-busy="true">
            <ListSkeleton rows={4} />
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-button text-muted-foreground">
              {t('financeLog.loadFailed')}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              {t('financeLog.retry')}
            </Button>
          </div>
        ) : (
          <ul role="list" className="flex flex-col divide-y-2 divide-border">
            {query.data.admins.map((admin) => (
              <AdminRates key={admin.userId} admin={admin} view={view} />
            ))}
          </ul>
        )}
      </DialogFrame>
    </SheetDialog>
  );
}

function AdminRates({ admin, view }: { admin: RatesDto['admins'][number]; view: FinanceView }) {
  const { t, i18n } = useTranslation();
  const f = useFinanceFormat();
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const first = admin.history.length === 0;
  const [fromStart, setFromStart] = useState(first);
  const [day, setDay] = useState(`${currentMonth()}-01`);
  const [invalid, setInvalid] = useState(false);
  const add = useAddRate(view);
  const remove = useDeleteRate(view);
  // The history row whose Delete waits for the inline confirmation.
  const [confirming, setConfirming] = useState<string | null>(null);
  const perHour = (minor: number) =>
    t('financeLog.ratesDialog.perHour', { amount: f.money(minor, COST_CURRENCY, false) });

  const save = () => {
    const money = parseMoney(amount, COST_CURRENCY);
    if (!money || money.amountMinor <= 0 || (!fromStart && !day)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    add.mutate(
      { userId: admin.userId, rateMinor: money.amountMinor, effectiveFrom: fromStart ? null : day },
      {
        onSuccess: () => {
          setEditing(false);
          setAmount('');
        },
      },
    );
  };

  return (
    <li className="flex flex-col gap-3 py-3" data-testid="rate-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 truncate text-button font-semibold">
          {admin.name}
          {!admin.active && (
            <span className="font-medium text-muted-foreground">
              {' '}
              ({t('financeLog.ratesDialog.inactive')})
            </span>
          )}
        </p>
        <p className="text-button tabular-nums">
          {admin.current ? (
            perHour(admin.current.rateMinor)
          ) : (
            <span className="text-muted-foreground">{t('financeLog.ratesDialog.none')}</span>
          )}
        </p>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
        >
          {t('financeLog.ratesDialog.change')}
        </Button>
      </div>
      {editing && (
        <form
          className="flex flex-col gap-3 rounded-lg bg-muted p-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid gap-3 min-[641px]:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${uid}-amount`}>{t('financeLog.ratesDialog.amount')}</Label>
              <Input
                id={`${uid}-amount`}
                value={amount}
                inputMode="decimal"
                placeholder="40"
                autoFocus
                aria-invalid={invalid || undefined}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${uid}-from`}>{t('financeLog.ratesDialog.from')}</Label>
              <Input
                id={`${uid}-from`}
                type="date"
                value={day}
                disabled={fromStart}
                onChange={(e) => setDay(e.target.value)}
              />
              <label className="flex items-center gap-2 text-tiny">
                <input
                  type="checkbox"
                  checked={fromStart}
                  onChange={(e) => setFromStart(e.target.checked)}
                />
                {t('financeLog.ratesDialog.fromStart')}
              </label>
            </div>
          </div>
          {invalid && (
            <p role="alert" className="text-tiny text-error-ink">
              {t('financeLog.ratesDialog.invalid')}
            </p>
          )}
          {add.isError && (
            <p role="alert" className="text-tiny text-error-ink">
              {t('financeLog.saveFailed')}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
              {t('financeLog.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={add.isPending}>
              {t('financeLog.save')}
            </Button>
          </div>
        </form>
      )}
      {admin.history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-tiny text-muted-foreground">
            {t('financeLog.ratesDialog.history', { count: admin.history.length })}
          </summary>
          <ul role="list" className="flex flex-col gap-1 pt-2 text-tiny">
            {admin.history.map((rate) => (
              <li key={rate.id} className="flex flex-wrap items-center gap-x-3">
                <span className="w-28 shrink-0">
                  {rate.effectiveFrom
                    ? new Intl.DateTimeFormat(i18n.language, { timeZone: 'UTC' }).format(
                        new Date(`${rate.effectiveFrom}T00:00:00Z`),
                      )
                    : t('financeLog.ratesDialog.fromStart')}
                </span>
                <span className="tabular-nums">{perHour(rate.rateMinor)}</span>
                <span className="flex-1 text-muted-foreground">{rate.createdByName}</span>
                {confirming === rate.id ? (
                  <InlineConfirm
                    question={t('financeLog.ratesDialog.deleteConfirm')}
                    confirmLabel={t('financeLog.workLog.delete')}
                    cancelLabel={t('financeLog.cancel')}
                    busy={remove.isPending}
                    onConfirm={() =>
                      remove.mutate(rate.id, { onSuccess: () => setConfirming(null) })
                    }
                    onCancel={() => setConfirming(null)}
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-error-ink"
                    disabled={remove.isPending}
                    onClick={() => setConfirming(rate.id)}
                  >
                    {t('financeLog.workLog.delete')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
