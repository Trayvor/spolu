import { useId, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ENABLED_CURRENCIES,
  FINANCE_LIMITS,
  MINOR_DIGITS,
  parseMoney,
  type Currency,
  type FileInfo,
  type FinanceItemBody,
  type FinanceItemDetail,
  type FinanceItemPatch,
  type FinanceItemType,
} from '@spolu/shared';
import { FilesField } from '@/components/files-field';
import { DescriptionField } from '@/features/editor/description-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ReminderTimesField,
  localToIso,
  newRowKey,
  type ReminderTimeValue,
} from '@/features/reminders/reminder-times-field';
import { financeUploadPath } from './api';
import { proposedReminder } from './format';

/** The form's values; the amount is the text as typed (`parseMoney` reads it on save). */
export type ItemFormValue = {
  title: string;
  body: string;
  fileIds: string[];
  contractNumber: string;
  amount: string;
  currency: Currency;
  startsOn: string;
  endsOn: string;
  /** A new contract's reminder times (an existing item edits them in its view). */
  times: ReminderTimeValue[];
  /** The times still follow the end date (the proposal), until someone edits them. */
  timesProposed: boolean;
};

export type ItemFormErrors = Partial<
  Record<'title' | 'contractNumber' | 'amount' | 'startsOn' | 'endsOn' | 'body' | 'form', string>
>;

const FIELD = 'flex flex-col gap-2.5';

export function emptyItemValue(): ItemFormValue {
  return {
    title: '',
    body: '',
    fileIds: [],
    contractNumber: '',
    amount: '',
    currency: ENABLED_CURRENCIES[0]!,
    startsOn: '',
    endsOn: '',
    times: [],
    timesProposed: true,
  };
}

/** The amount as the form shows it: `1200.5` minor-free, in the UI language's decimal mark. */
export function amountText(amountMinor: number, currency: Currency, language: string): string {
  const digits = MINOR_DIGITS[currency];
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: amountMinor % 10 ** digits === 0 ? 0 : digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(amountMinor / 10 ** digits);
}

export function fromItem(item: FinanceItemDetail, language: string): ItemFormValue {
  const c = item.contract;
  return {
    ...emptyItemValue(),
    title: item.title,
    body: item.body,
    fileIds: item.files.map((f) => f.id),
    contractNumber: c?.contractNumber ?? '',
    amount: c ? amountText(c.amount.amountMinor, c.amount.currency, language) : '',
    currency: c?.amount.currency ?? ENABLED_CURRENCIES[0]!,
    startsOn: c?.startsOn ?? '',
    endsOn: c?.endsOn ?? '',
    timesProposed: false,
  };
}

/** Field errors (the keys are the `financeDocuments.form.errors.*` texts' messages). */
export function validateItem(
  type: FinanceItemType,
  value: ItemFormValue,
  t: (key: string) => string,
): ItemFormErrors {
  const errors: ItemFormErrors = {};
  const e = (key: string) => t(`financeDocuments.form.errors.${key}`);
  const title = value.title.trim();
  if (!title) errors.title = e('titleRequired');
  else if (title.length > FINANCE_LIMITS.title) errors.title = e('titleTooLong');
  if (value.body.length > FINANCE_LIMITS.body) errors.body = e('bodyTooLong');
  if (type === 'contract') {
    if (value.contractNumber.trim().length > FINANCE_LIMITS.contractNumber) {
      errors.contractNumber = e('numberTooLong');
    }
    if (!parseMoney(value.amount, value.currency)) errors.amount = e('amountInvalid');
    if (!value.startsOn) errors.startsOn = e('startRequired');
    if (!value.endsOn) errors.endsOn = e('endRequired');
    else if (value.startsOn && value.endsOn < value.startsOn) errors.endsOn = e('endBeforeStart');
  }
  return errors;
}

/** The create body (`validateItem` passed). */
export function toBody(
  type: FinanceItemType,
  value: ItemFormValue,
  folderId: string | null,
): FinanceItemBody {
  const common = {
    title: value.title.trim(),
    body: value.body,
    folderId,
    fileIds: value.fileIds,
  };
  if (type !== 'contract') return { type, ...common };
  return {
    type,
    ...common,
    contractNumber: value.contractNumber.trim() || null,
    amount: parseMoney(value.amount, value.currency)!,
    startsOn: value.startsOn,
    endsOn: value.endsOn,
  };
}

/** The changed fields of an edit, with the `updatedAt` it started from. */
export function toPatch(item: FinanceItemDetail, value: ItemFormValue): FinanceItemPatch {
  const patch: FinanceItemPatch = { updatedAt: item.updatedAt };
  const title = value.title.trim();
  if (title !== item.title) patch.title = title;
  if (value.body !== item.body) patch.body = value.body;
  const files = item.files.map((f) => f.id);
  if (JSON.stringify(value.fileIds) !== JSON.stringify(files)) patch.fileIds = value.fileIds;
  const c = item.contract;
  if (c) {
    const number = value.contractNumber.trim();
    if (number !== (c.contractNumber ?? '')) patch.contractNumber = number || null;
    const amount = parseMoney(value.amount, value.currency);
    if (
      amount &&
      (amount.amountMinor !== c.amount.amountMinor || amount.currency !== c.amount.currency)
    ) {
      patch.amount = amount;
    }
    if (value.startsOn !== c.startsOn) patch.startsOn = value.startsOn;
    if (value.endsOn !== c.endsOn) patch.endsOn = value.endsOn;
  }
  return patch;
}

/** The new contract's proposed reminder rows for its end date (none when it has passed). */
export function proposedTimes(endsOn: string, now = new Date()): ReminderTimeValue[] {
  const proposal = proposedReminder(endsOn, now);
  return proposal ? [{ key: newRowKey(), ...proposal, firedAt: null }] : [];
}

/** The reminder times to save after a create: valid, future, unfired. */
export function timesToSave(times: ReminderTimeValue[], now = new Date()): { at: string }[] {
  return times
    .map((row) => localToIso(row.date, row.time))
    .filter((iso) => iso !== '' && Date.parse(iso) > now.getTime() + 60_000)
    .map((at) => ({ at }));
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-tiny text-error-ink">
      {message}
    </p>
  );
}

/**
 * The fields of a finance item, controlled by the sheet: title, a contract's number, amount and
 * period, the description (Markdown, the chat toolbar), the finance-only files, and for a new
 * contract its reminder times (proposed 30 days before the end at 09:00, following the end date
 * until edited). Needs the `financeDocuments`, `reminders`, `forms` and `chat` namespaces.
 */
export function ItemForm({
  type,
  groupId,
  value,
  onChange,
  errors,
  files,
  onFilesChange,
  isNew,
  onUploadingChange,
}: {
  type: FinanceItemType;
  groupId: string;
  value: ItemFormValue;
  onChange: Dispatch<SetStateAction<ItemFormValue>>;
  errors: ItemFormErrors;
  files: FileInfo[];
  onFilesChange: Dispatch<SetStateAction<FileInfo[]>>;
  isNew: boolean;
  /** True while a file uploads; the sheet keeps Create/Save disabled until it is false. */
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const set = <K extends keyof ItemFormValue>(key: K, next: ItemFormValue[K]) =>
    onChange((prev) => ({ ...prev, [key]: next }));
  const k = (key: string) => t(`financeDocuments.form.${key}`);
  const contract = type === 'contract';
  const err = (key: keyof ItemFormErrors) => ({
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${uid}-${key}-error` : undefined,
  });

  return (
    <div className="flex flex-col gap-5">
      <div className={FIELD}>
        <Label htmlFor={`${uid}-title`}>{k('title')}</Label>
        <Input
          id={`${uid}-title`}
          value={value.title}
          autoFocus={isNew}
          maxLength={FINANCE_LIMITS.title + 20}
          onChange={(event) => set('title', event.target.value)}
          {...err('title')}
        />
        <FieldError id={`${uid}-title-error`} message={errors.title} />
      </div>

      {contract && (
        <>
          <div className="grid gap-5 min-[641px]:grid-cols-2">
            <div className={FIELD}>
              <Label htmlFor={`${uid}-number`}>
                {k('number')}{' '}
                <span className="font-medium text-muted-foreground">({k('optional')})</span>
              </Label>
              <Input
                id={`${uid}-number`}
                value={value.contractNumber}
                maxLength={FINANCE_LIMITS.contractNumber + 10}
                onChange={(event) => set('contractNumber', event.target.value)}
                {...err('contractNumber')}
              />
              <FieldError id={`${uid}-contractNumber-error`} message={errors.contractNumber} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${uid}-amount`}>{k('amount')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${uid}-amount`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={value.amount}
                  onChange={(event) => set('amount', event.target.value)}
                  className="min-w-0 flex-1 text-right tabular-nums"
                  {...err('amount')}
                />
                {ENABLED_CURRENCIES.length > 1 ? (
                  <select
                    aria-label={k('currency')}
                    value={value.currency}
                    onChange={(event) => set('currency', event.target.value as Currency)}
                    className="h-[38px] rounded-full border-2 border-input bg-background px-3 text-button"
                  >
                    {ENABLED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-button font-semibold" aria-label={k('currency')}>
                    {value.currency}
                  </span>
                )}
              </div>
              <FieldError id={`${uid}-amount-error`} message={errors.amount} />
            </div>
          </div>
          <fieldset className={FIELD}>
            <legend className="mb-2.5 text-button font-semibold">{k('period')}</legend>
            <div className="grid gap-3 min-[641px]:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-starts`} className="text-tiny">
                  {k('startsOn')}
                </Label>
                <Input
                  id={`${uid}-starts`}
                  type="date"
                  value={value.startsOn}
                  onChange={(event) => set('startsOn', event.target.value)}
                  {...err('startsOn')}
                />
                <FieldError id={`${uid}-startsOn-error`} message={errors.startsOn} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-ends`} className="text-tiny">
                  {k('endsOn')}
                </Label>
                <Input
                  id={`${uid}-ends`}
                  type="date"
                  value={value.endsOn}
                  min={value.startsOn || undefined}
                  onChange={(event) => {
                    const endsOn = event.target.value;
                    onChange((prev) => ({
                      ...prev,
                      endsOn,
                      ...(isNew && prev.timesProposed ? { times: proposedTimes(endsOn) } : {}),
                    }));
                  }}
                  {...err('endsOn')}
                />
                <FieldError id={`${uid}-endsOn-error`} message={errors.endsOn} />
              </div>
            </div>
          </fieldset>
        </>
      )}

      <DescriptionField
        id={`${uid}-body`}
        groupId={groupId}
        value={value.body}
        onChange={(body) => set('body', body)}
        label={type === 'note' ? k('text') : k('description')}
        editLabel={type === 'note' ? k('editText') : k('editDescription')}
        error={errors.body}
        errorId={`${uid}-body-error`}
      />

      <div className={FIELD}>
        <span id={`${uid}-files`} className="text-button font-semibold">
          {k('files')}
        </span>
        <FilesField
          groupId={groupId}
          uploadPath={financeUploadPath(groupId)}
          fileIds={value.fileIds}
          files={files}
          // Updaters: several uploads may finish after this render.
          onAdd={(file) => {
            onFilesChange((list) => [...list, file]);
            onChange((prev) => ({ ...prev, fileIds: [...prev.fileIds, file.id] }));
          }}
          onRemove={(id) => {
            onFilesChange((list) => list.filter((f) => f.id !== id));
            onChange((prev) => ({ ...prev, fileIds: prev.fileIds.filter((x) => x !== id) }));
          }}
          labelId={`${uid}-files`}
          max={FINANCE_LIMITS.filesPerItem}
          inputTestId="finance-file-input"
          onPendingChange={onUploadingChange}
        />
      </div>

      {contract && isNew && (
        <div className={FIELD}>
          <span className="text-button font-semibold">{k('reminders')}</span>
          <p className="text-tiny text-muted-foreground">{k('reminderHint')}</p>
          <ReminderTimesField
            value={value.times}
            onChange={(times) => onChange((prev) => ({ ...prev, times, timesProposed: false }))}
          />
        </div>
      )}
    </div>
  );
}
