import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ScheduleFrequencies, SCHEDULE_LIMITS, type ContractChoice } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { contractChoicesQuery } from './api';
import type { ContractFormErrorKey, ContractFormValue, ScheduleChoice } from './contract-form';

/**
 * Contracts v2 (ADR 0066): the master picker and the payment schedule of a contract's form, and
 * the contract picker with the payment of a document's form. Controlled by `ItemForm`; texts in
 * `financeDocuments.contracts`.
 */

const FIELD = 'flex flex-col gap-2.5';

type Errors = Partial<Record<ContractFormErrorKey, string>>;
type Set = <K extends keyof ContractFormValue>(key: K, next: ContractFormValue[K]) => void;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-tiny text-error-ink">
      {message}
    </p>
  );
}

const choiceLabel = (c: ContractChoice) =>
  c.contractNumber ? `${c.contractNumber} · ${c.title}` : c.title;

/**
 * The master contract (one level): the contracts of the same client (or of several clients
 * covering it), never this one, one under a master, nor any when this one is a master itself.
 */
export function MasterField({
  choicesOf,
  value,
  set,
  itemId,
  childCount,
}: {
  /** The client whose contracts are offered (null: the organisation's of several clients). */
  choicesOf: string | null | undefined;
  value: ContractFormValue;
  set: Set;
  itemId?: string;
  childCount: number;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`financeDocuments.contracts.${key}`, options);
  const choices = useQuery({
    ...contractChoicesQuery(choicesOf ?? null),
    enabled: choicesOf !== undefined && childCount === 0,
  }).data;
  if (choicesOf === undefined) return null;
  if (childCount > 0) {
    return (
      <div className={FIELD}>
        <span className="text-button font-semibold">{k('master')}</span>
        <p className="text-tiny text-muted-foreground">{k('isMaster', { n: childCount })}</p>
      </div>
    );
  }
  const options = (choices ?? []).filter(
    (c) => c.id !== itemId && (c.parentId === null || c.id === value.parentId),
  );
  return (
    <div className={FIELD}>
      <Label htmlFor={`${uid}-master`}>
        {k('master')}{' '}
        <span className="font-medium text-muted-foreground">
          ({t('financeDocuments.form.optional')})
        </span>
      </Label>
      <p id={`${uid}-master-hint`} className="-mt-1 text-tiny text-muted-foreground">
        {k('masterHint')}
      </p>
      <Select
        id={`${uid}-master`}
        aria-describedby={`${uid}-master-hint`}
        value={value.parentId ?? ''}
        onChange={(event) => set('parentId', event.target.value || null)}
        containerClassName="w-full"
      >
        <option value="">{k('noMaster')}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {choiceLabel(c)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** The payment schedule: none, a fixed frequency, every N months, or a list of days. */
export function ScheduleField({
  value,
  set,
  errors,
  currency,
}: {
  value: ContractFormValue;
  set: Set;
  errors: Errors;
  currency: string;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`financeDocuments.contracts.${key}`, options);
  const freq = value.scheduleFrequency;
  const err = (key: ContractFormErrorKey) => ({
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${uid}-${key}-error` : undefined,
  });
  return (
    <fieldset className={FIELD} data-testid="schedule-field">
      <legend className="mb-2.5 text-button font-semibold">{k('schedule')}</legend>
      <Select
        aria-label={k('frequencyLabel')}
        value={freq}
        onChange={(event) => set('scheduleFrequency', event.target.value as ScheduleChoice)}
        containerClassName="w-full"
      >
        {(['none', ...ScheduleFrequencies] as const).map((f) => (
          <option key={f} value={f}>
            {k(`frequency.${f}`)}
          </option>
        ))}
      </Select>
      {freq !== 'none' && (
        <div className="grid gap-3 min-[641px]:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-per`} className="text-tiny">
              {k('perPeriod')}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`${uid}-per`}
                inputMode="decimal"
                autoComplete="off"
                value={value.scheduleAmount}
                onChange={(event) => set('scheduleAmount', event.target.value)}
                className="min-w-0 flex-1 text-right tabular-nums"
                {...err('scheduleAmount')}
              />
              <span className="text-button font-semibold">{currency}</span>
            </div>
            <FieldError id={`${uid}-scheduleAmount-error`} message={errors.scheduleAmount} />
          </div>
          {freq === 'everyMonths' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-every`} className="text-tiny">
                {k('everyMonthsLabel')}
              </Label>
              <Input
                id={`${uid}-every`}
                type="number"
                min={1}
                max={SCHEDULE_LIMITS.maxEveryMonths}
                value={value.scheduleEvery}
                onChange={(event) => set('scheduleEvery', event.target.value)}
                {...err('scheduleEvery')}
              />
              <FieldError id={`${uid}-scheduleEvery-error`} message={errors.scheduleEvery} />
            </div>
          )}
          {freq !== 'dates' && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-sstart`} className="text-tiny">
                  {k('scheduleStarts')}
                </Label>
                <Input
                  id={`${uid}-sstart`}
                  type="date"
                  value={value.scheduleStartsOn}
                  onChange={(event) => set('scheduleStartsOn', event.target.value)}
                  {...err('scheduleStartsOn')}
                />
                <FieldError
                  id={`${uid}-scheduleStartsOn-error`}
                  message={errors.scheduleStartsOn}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-send`} className="text-tiny">
                  {k('scheduleEnds')}{' '}
                  <span className="font-medium text-muted-foreground">
                    ({t('financeDocuments.form.optional')})
                  </span>
                </Label>
                <Input
                  id={`${uid}-send`}
                  type="date"
                  value={value.scheduleEndsOn}
                  min={value.scheduleStartsOn || undefined}
                  onChange={(event) => set('scheduleEndsOn', event.target.value)}
                  {...err('scheduleEndsOn')}
                />
                <p className="text-micro text-muted-foreground">{k('scheduleEndsHint')}</p>
                <FieldError id={`${uid}-scheduleEndsOn-error`} message={errors.scheduleEndsOn} />
              </div>
            </>
          )}
        </div>
      )}
      {freq === 'dates' && (
        <div className="flex flex-col gap-2">
          <span className="text-tiny font-semibold">{k('dates')}</span>
          {value.scheduleDates.map((day, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                type="date"
                aria-label={k('dateN', { n: index + 1 })}
                value={day}
                onChange={(event) =>
                  set(
                    'scheduleDates',
                    value.scheduleDates.map((d, i) => (i === index ? event.target.value : d)),
                  )
                }
                className="min-w-0 flex-1"
                {...(errors.scheduleDates ? { 'aria-invalid': true } : {})}
              />
              {value.scheduleDates.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={k('removeDate', { n: index + 1 })}
                  onClick={() =>
                    set(
                      'scheduleDates',
                      value.scheduleDates.filter((_, i) => i !== index),
                    )
                  }
                >
                  ×
                </Button>
              )}
            </div>
          ))}
          {value.scheduleDates.length < SCHEDULE_LIMITS.maxDates && (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => set('scheduleDates', [...value.scheduleDates, ''])}
              >
                {k('addDate')}
              </Button>
            </div>
          )}
          <FieldError id={`${uid}-scheduleDates-error`} message={errors.scheduleDates} />
        </div>
      )}
      {freq !== 'none' && <p className="text-tiny text-muted-foreground">{k('scheduleHint')}</p>}
    </fieldset>
  );
}

/** A document's contract and the payment the document records. */
export function ContractLinkField({
  choicesOf,
  value,
  set,
  errors,
  currency,
}: {
  choicesOf: string | null;
  value: ContractFormValue;
  set: Set;
  errors: Errors;
  currency: string;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`financeDocuments.contracts.${key}`, options);
  const choices = useQuery(contractChoicesQuery(choicesOf)).data ?? [];
  return (
    <fieldset className={FIELD} data-testid="contract-link-field">
      <legend className="mb-2.5 text-button font-semibold">
        {k('link')}{' '}
        <span className="font-medium text-muted-foreground">
          ({t('financeDocuments.form.optional')})
        </span>
      </legend>
      <Select
        aria-label={k('link')}
        value={value.linkContractId ?? ''}
        onChange={(event) => set('linkContractId', event.target.value || null)}
        containerClassName="w-full"
      >
        <option value="">{k('noLink')}</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {choiceLabel(c)}
          </option>
        ))}
      </Select>
      {value.linkContractId && (
        <div className="grid gap-3 min-[641px]:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-pay`} className="text-tiny">
              {k('payment')}{' '}
              <span className="font-medium text-muted-foreground">
                ({t('financeDocuments.form.optional')})
              </span>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`${uid}-pay`}
                inputMode="decimal"
                autoComplete="off"
                value={value.linkAmount}
                onChange={(event) => set('linkAmount', event.target.value)}
                className="min-w-0 flex-1 text-right tabular-nums"
                aria-invalid={errors.linkAmount ? true : undefined}
                aria-describedby={errors.linkAmount ? `${uid}-linkAmount-error` : undefined}
              />
              <span className="text-button font-semibold">{currency}</span>
            </div>
            <FieldError id={`${uid}-linkAmount-error`} message={errors.linkAmount} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-paid`} className="text-tiny">
              {k('paidOn')}
            </Label>
            <Input
              id={`${uid}-paid`}
              type="date"
              value={value.linkPaidOn}
              onChange={(event) => set('linkPaidOn', event.target.value)}
              aria-invalid={errors.linkPaidOn ? true : undefined}
              aria-describedby={errors.linkPaidOn ? `${uid}-linkPaidOn-error` : undefined}
            />
            <FieldError id={`${uid}-linkPaidOn-error`} message={errors.linkPaidOn} />
          </div>
          <p className="text-tiny text-muted-foreground min-[641px]:col-span-2">
            {k('paymentHint')}
          </p>
        </div>
      )}
    </fieldset>
  );
}
