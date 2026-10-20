import { useId, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ENABLED_CURRENCIES,
  FINANCE_LIMITS,
  MINOR_DIGITS,
  parseMoney,
  shareProblem,
  type Currency,
  type FileInfo,
  type FinanceItemBody,
  type FinanceItemDetail,
  type FinanceItemPatch,
  type FinanceItemType,
  type FinanceOrgItemBody,
  type GroupPerson,
} from '@spolu/shared';
import { FilesField } from '@/components/files-field';
import { DescriptionField } from '@/features/editor/description-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ProjectSelect } from '@/features/projects/project-select';
import {
  ReminderTimesField,
  localToIso,
  newRowKey,
  type ReminderTimeValue,
} from '@/features/reminders/reminder-times-field';
import { financeUploadPath, type FinanceOwner } from './api';
import { proposedExpenseReminder, proposedReminder } from './format';
import { newShareRow, SharesField, type ShareRow } from './shares-field';

/**
 * Who a new item made on `/finance` belongs to (Phase 32 E, decision E13): the organisation,
 * one client (made as in its tab) or, for a contract, several clients with shares.
 */
type OwnerChoice = 'org' | 'client' | 'shared';

/** The form's values; amounts are the text as typed (`parseMoney` reads them on save). */
export type ItemFormValue = {
  title: string;
  body: string;
  fileIds: string[];
  contractNumber: string;
  amount: string;
  currency: Currency;
  startsOn: string;
  endsOn: string;
  /** A new item's reminder times (an existing item edits them in its view). */
  times: ReminderTimeValue[];
  /** The times still follow the end date (or the expense's date), until someone edits them. */
  timesProposed: boolean;
  /** Phase 32 E: a new item on `/finance`: whose it is, and the client when it is one. */
  owner: OwnerChoice;
  clientId: string;
  /** A contract of several clients: the payer and the shares. */
  payerName: string;
  shares: ShareRow[];
  /** An expense: its date (admins' salaries are salary records since 2026-10-21). */
  spentOn: string;
  /** A contract of one client: one of its projects (Phase 33 P6, decision 23), or none. */
  projectId: string | null;
};

export type ItemFormErrors = Partial<
  Record<
    | 'title'
    | 'contractNumber'
    | 'amount'
    | 'startsOn'
    | 'endsOn'
    | 'body'
    | 'form'
    | 'client'
    | 'payerName'
    | 'shares'
    | 'spentOn',
    string
  >
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
    owner: 'org',
    clientId: '',
    payerName: '',
    shares: [newShareRow(), newShareRow()],
    spentOn: '',
    projectId: null,
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
  const e = item.expense;
  // A contract of several clients is edited with its whole amount (`/finance` reads it whole).
  const money = c?.shared?.total ?? c?.amount ?? e?.amount ?? null;
  const currency = money?.currency ?? ENABLED_CURRENCIES[0]!;
  return {
    ...emptyItemValue(),
    title: item.title,
    body: item.body,
    fileIds: item.files.map((f) => f.id),
    contractNumber: c?.contractNumber ?? '',
    amount: money ? amountText(money.amountMinor, money.currency, language) : '',
    currency,
    startsOn: c?.startsOn ?? '',
    endsOn: c?.endsOn ?? '',
    timesProposed: false,
    owner: item.groupId !== null ? 'client' : c?.shared ? 'shared' : 'org',
    clientId: item.groupId ?? '',
    payerName: c?.shared?.payerName ?? '',
    shares:
      c?.shared?.shares.map((s) => ({
        ...newShareRow(s.groupId),
        amount: amountText(s.amountMinor, currency, language),
      })) ?? [],
    spentOn: e?.spentOn ?? '',
    // A deleted project is no choice any more: the form shows none, and keeps it unless edited.
    projectId: c?.project?.id ?? null,
  };
}

/** The shares as minor units, or null when one is not an amount or has no client. */
function shareInputs(value: ItemFormValue) {
  const shares = [];
  for (const row of value.shares) {
    const money = parseMoney(row.amount, value.currency);
    if (!money || !row.groupId) return null;
    shares.push({ groupId: row.groupId, amountMinor: money.amountMinor });
  }
  return shares;
}

/** Field errors (the keys are the `financeDocuments.form.errors.*` / `financeOrg.errors.*` texts). */
export function validateItem(
  type: FinanceItemType,
  value: ItemFormValue,
  t: (key: string) => string,
  opts: { shared?: boolean; isNew?: boolean } = {},
): ItemFormErrors {
  const errors: ItemFormErrors = {};
  const e = (key: string) => t(`financeDocuments.form.errors.${key}`);
  const o = (key: string) => t(`financeOrg.errors.${key}`);
  const title = value.title.trim();
  if (!title) errors.title = type === 'expense' ? o('whatRequired') : e('titleRequired');
  else if (title.length > FINANCE_LIMITS.title) errors.title = e('titleTooLong');
  if (value.body.length > FINANCE_LIMITS.body) errors.body = e('bodyTooLong');
  if (opts.isNew && value.owner === 'client' && type !== 'expense' && !value.clientId) {
    errors.client = o('chooseClient');
  }
  if (type === 'contract') {
    if (value.contractNumber.trim().length > FINANCE_LIMITS.contractNumber) {
      errors.contractNumber = e('numberTooLong');
    }
    if (!parseMoney(value.amount, value.currency)) errors.amount = e('amountInvalid');
    if (!value.startsOn) errors.startsOn = e('startRequired');
    if (!value.endsOn) errors.endsOn = e('endRequired');
    else if (value.startsOn && value.endsOn < value.startsOn) errors.endsOn = e('endBeforeStart');
    if (opts.shared) {
      if (!value.payerName.trim()) errors.payerName = o('payerRequired');
      else if (value.payerName.trim().length > FINANCE_LIMITS.payerName) {
        errors.payerName = e('titleTooLong');
      }
      const total = parseMoney(value.amount, value.currency);
      const shares = shareInputs(value);
      if (!shares) {
        errors.shares = value.shares.some((r) => !r.groupId) ? o('shareClient') : o('shareInvalid');
      } else if (total) {
        const problem = shareProblem(total.amountMinor, shares);
        if (problem) {
          errors.shares = o(
            problem === 'tooFew'
              ? 'sharesTooFew'
              : problem === 'duplicate'
                ? 'sharesDuplicate'
                : problem === 'sum'
                  ? 'sharesSum'
                  : problem === 'tooMany'
                    ? 'sharesTooMany'
                    : 'shareInvalid',
          );
        }
      }
    }
  }
  if (type === 'expense') {
    if (!parseMoney(value.amount, value.currency)) errors.amount = e('amountInvalid');
    if (!value.spentOn) errors.spentOn = o('dateRequired');
  }
  return errors;
}

/** The create body of a client's item (`validateItem` passed). */
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
  if (type === 'document' || type === 'note') return { type, ...common };
  return {
    type: 'contract',
    ...common,
    contractNumber: value.contractNumber.trim() || null,
    amount: parseMoney(value.amount, value.currency)!,
    startsOn: value.startsOn,
    endsOn: value.endsOn,
    projectId: value.projectId,
  };
}

/**
 * The create body of an item of the organisation (Phase 32 E; `validateItem` passed): a contract
 * of several clients, an expense, a document or a note.
 */
export function toOrgBody(
  type: FinanceItemType,
  value: ItemFormValue,
  folderId: string | null,
): FinanceOrgItemBody {
  const common = { title: value.title.trim(), body: value.body, folderId, fileIds: value.fileIds };
  const amount = () => parseMoney(value.amount, value.currency)!;
  if (type === 'expense') {
    return {
      type,
      ...common,
      expenseKind: 'other',
      amount: amount(),
      spentOn: value.spentOn,
    };
  }
  if (type === 'contract') {
    return {
      type,
      ...common,
      contractNumber: value.contractNumber.trim() || null,
      amount: amount(),
      startsOn: value.startsOn,
      endsOn: value.endsOn,
      payerName: value.payerName.trim(),
      shares: shareInputs(value) ?? [],
    };
  }
  return { type, ...common };
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
  const amount = parseMoney(value.amount, value.currency);
  if (c) {
    const number = value.contractNumber.trim();
    if (number !== (c.contractNumber ?? '')) patch.contractNumber = number || null;
    const was = c.shared?.total ?? c.amount;
    if (amount && (amount.amountMinor !== was.amountMinor || amount.currency !== was.currency)) {
      patch.amount = amount;
    }
    if (value.startsOn !== c.startsOn) patch.startsOn = value.startsOn;
    if (value.endsOn !== c.endsOn) patch.endsOn = value.endsOn;
    if (!c.shared && value.projectId !== (c.project?.id ?? null)) patch.projectId = value.projectId;
    if (c.shared) {
      const payer = value.payerName.trim();
      if (payer !== c.shared.payerName) patch.payerName = payer;
      const shares = shareInputs(value);
      const before = c.shared.shares.map((s) => ({
        groupId: s.groupId,
        amountMinor: s.amountMinor,
      }));
      // The shares go whole: also when only the amount changed, so they add up to it again.
      if (shares && (JSON.stringify(shares) !== JSON.stringify(before) || patch.amount)) {
        patch.shares = shares;
      }
    }
  }
  const e = item.expense;
  if (e) {
    if (
      amount &&
      (amount.amountMinor !== e.amount.amountMinor || amount.currency !== e.amount.currency)
    ) {
      patch.amount = amount;
    }
    if (value.spentOn !== e.spentOn) patch.spentOn = value.spentOn;
  }
  return patch;
}

/** A new contract's proposed reminder rows for its end date (none when it has passed). */
function proposedTimes(endsOn: string, now = new Date()): ReminderTimeValue[] {
  const proposal = proposedReminder(endsOn, now);
  return proposal ? [{ key: newRowKey(), ...proposal, firedAt: null }] : [];
}

/** A new expense's proposed reminder rows: the day before its date (Phase 32 E). */
function proposedExpenseTimes(spentOn: string, now = new Date()): ReminderTimeValue[] {
  const proposal = proposedExpenseReminder(spentOn, now);
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

/** What the form needs besides the value (Phase 32 E): clients, mention people. */
export type ItemFormContext = {
  owner: FinanceOwner;
  /** `/finance`'s create: the "for whom" choice and the clients to pick. */
  clients?: readonly { id: string; name: string }[];
  /** The people a description's mentions are named from (the organisation has no group). */
  people?: GroupPerson[];
};

/**
 * The fields of a finance item, controlled by the sheet: on `/finance` first whose it is
 * (organisation, a client, several clients), then the title, a contract's number, amount and
 * period (with the payer and the shares for several clients), an expense's amount and date, the description (Markdown, the chat toolbar), the finance-only files, and for a new
 * contract or expense its reminder times (proposed, following the date until edited). Needs the
 * `financeDocuments`, `financeOrg`, `reminders`, `forms` and `chat` namespaces.
 */
export function ItemForm({
  type,
  context,
  value,
  onChange,
  errors,
  files,
  onFilesChange,
  isNew,
  onUploadingChange,
}: {
  type: FinanceItemType;
  context: ItemFormContext;
  value: ItemFormValue;
  onChange: Dispatch<SetStateAction<ItemFormValue>>;
  errors: ItemFormErrors;
  files: FileInfo[];
  onFilesChange: Dispatch<SetStateAction<FileInfo[]>>;
  isNew: boolean;
  /** True while a file uploads; the sheet keeps Create/Save disabled until it is false. */
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const set = <K extends keyof ItemFormValue>(key: K, next: ItemFormValue[K]) =>
    onChange((prev) => ({ ...prev, [key]: next }));
  const k = (key: string) => t(`financeDocuments.form.${key}`);
  const o = (key: string) => t(`financeOrg.form.${key}`);
  const contract = type === 'contract';
  const expense = type === 'expense';
  const org = context.owner.kind === 'org';
  const shared = contract && org && value.owner === 'shared';
  // A new item on `/finance` chooses whose it is; an expense always is the organisation's.
  const choosesOwner = isNew && org && !expense && context.clients !== undefined;
  // Files of a new item made for one client from `/finance` go to that client.
  const uploadOwner: FinanceOwner =
    choosesOwner && value.owner === 'client' && value.clientId
      ? { kind: 'group', groupId: value.clientId }
      : context.owner;
  const groupId = context.owner.kind === 'group' ? context.owner.groupId : '';
  // The client whose projects a contract may name (one client only, never several).
  const projectGroup =
    contract && !shared
      ? context.owner.kind === 'group'
        ? context.owner.groupId
        : value.owner === 'client' && value.clientId
          ? value.clientId
          : null
      : null;
  const err = (key: keyof ItemFormErrors) => ({
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${uid}-${key}-error` : undefined,
  });

  const amountField = (
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
  );

  return (
    <div className="flex flex-col gap-5">
      {choosesOwner && (
        <fieldset className={FIELD}>
          <legend className="mb-2.5 text-button font-semibold">{o('owner')}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2" role="radiogroup">
            {/* A contract has one client or several; a document or a note may have none. */}
            {(contract ? ['client', 'shared'] : ['org', 'client']).map((choice) => (
              <label key={choice} className="flex items-center gap-2 text-button">
                <input
                  type="radio"
                  name={`${uid}-owner`}
                  value={choice}
                  checked={value.owner === choice}
                  onChange={() => set('owner', choice as OwnerChoice)}
                  className="size-4 accent-foreground"
                />
                {o(`owners.${choice}`)}
              </label>
            ))}
          </div>
          {value.owner === 'client' && (
            <>
              <Select
                aria-label={o('client')}
                value={value.clientId}
                onChange={(event) => {
                  const clientId = event.target.value;
                  // Projects are per client: another client drops the project.
                  onChange((prev) => ({ ...prev, clientId, projectId: null }));
                }}
                containerClassName="w-full"
                {...err('client')}
              >
                <option value="">{o('chooseClient')}</option>
                {context.clients!.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <FieldError id={`${uid}-client-error`} message={errors.client} />
            </>
          )}
        </fieldset>
      )}

      <div className={FIELD}>
        <Label htmlFor={`${uid}-title`}>{expense ? o('what') : k('title')}</Label>
        <Input
          id={`${uid}-title`}
          value={value.title}
          autoFocus={isNew && !choosesOwner && !expense}
          maxLength={FINANCE_LIMITS.title + 20}
          placeholder={expense ? o('whatHint') : undefined}
          onChange={(event) => set('title', event.target.value)}
          {...err('title')}
        />
        <FieldError id={`${uid}-title-error`} message={errors.title} />
      </div>

      {expense && (
        <div className="grid gap-5 min-[641px]:grid-cols-2">
          {amountField}
          <div className={FIELD}>
            <Label htmlFor={`${uid}-spent`}>{o('date')}</Label>
            <Input
              id={`${uid}-spent`}
              type="date"
              value={value.spentOn}
              onChange={(event) => {
                const spentOn = event.target.value;
                onChange((prev) => ({
                  ...prev,
                  spentOn,
                  ...(isNew && prev.timesProposed ? { times: proposedExpenseTimes(spentOn) } : {}),
                }));
              }}
              {...err('spentOn')}
            />
            <FieldError id={`${uid}-spentOn-error`} message={errors.spentOn} />
          </div>
        </div>
      )}

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
            {amountField}
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
          {projectGroup && (
            <div className={FIELD}>
              <Label htmlFor={`${uid}-project`}>{k('project')}</Label>
              <ProjectSelect
                id={`${uid}-project`}
                groupId={projectGroup}
                value={value.projectId}
                onChange={(projectId) => set('projectId', projectId)}
                labels={{
                  label: k('project'),
                  none: k('noProject'),
                  archived: (name) => t('financeDocuments.form.archivedProject', { name }),
                }}
              />
            </div>
          )}
          {shared && (
            <>
              <div className={FIELD}>
                <Label htmlFor={`${uid}-payer`}>{o('payer')}</Label>
                <p id={`${uid}-payer-hint`} className="-mt-1 text-tiny text-muted-foreground">
                  {o('payerHint')}
                </p>
                <Input
                  id={`${uid}-payer`}
                  value={value.payerName}
                  maxLength={FINANCE_LIMITS.payerName + 20}
                  onChange={(event) => set('payerName', event.target.value)}
                  {...err('payerName')}
                />
                <FieldError id={`${uid}-payerName-error`} message={errors.payerName} />
              </div>
              <SharesField
                rows={value.shares}
                onChange={(shares) => set('shares', shares)}
                clients={context.clients ?? []}
                totalText={value.amount}
                currency={value.currency}
                language={i18n.language}
                error={errors.shares}
                toText={(minor) => amountText(minor, value.currency, i18n.language)}
              />
            </>
          )}
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
        {...(context.people ? { people: context.people } : {})}
        // The AI tools work on a client's group; the organisation has none.
        aiTools={context.owner.kind === 'group'}
      />

      <div className={FIELD}>
        <span id={`${uid}-files`} className="text-button font-semibold">
          {k('files')}
        </span>
        <FilesField
          groupId={groupId}
          uploadPath={financeUploadPath(uploadOwner)}
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

      {(contract || expense) && isNew && (
        <div className={FIELD}>
          <span className="text-button font-semibold">{k('reminders')}</span>
          <p className="text-tiny text-muted-foreground">
            {expense ? o('reminderHint') : k('reminderHint')}
          </p>
          <ReminderTimesField
            value={value.times}
            onChange={(times) => onChange((prev) => ({ ...prev, times, timesProposed: false }))}
          />
        </div>
      )}
    </div>
  );
}
