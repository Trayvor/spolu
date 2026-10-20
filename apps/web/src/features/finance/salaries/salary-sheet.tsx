import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ENABLED_CURRENCIES,
  formatMoney,
  parseMoney,
  SALARY_LIMITS,
  type Currency,
  type FileInfo,
  type SalaryBody,
  type SalaryDetail,
  type SalaryPatch,
} from '@spolu/shared';
import { FilesField } from '@/components/files-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelHeader } from '@/components/ui/panel-header';
import { PanelNotice } from '@/components/ui/panel-notice';
import { Select } from '@/components/ui/select';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { ApiError } from '@/lib/api';
import { FileChip } from '@/features/files/file-chip';
import { formatCreated } from '@/features/tasks/dates';
import { financePayeesQuery, financeUploadPath, ORG_OWNER } from '../documents/api';
import { amountText } from '../documents/item-form';
import { createSalary, deleteSalary, formatMonth, salaryQuery, updateSalary } from './api';
import { LinkedDocuments } from './linked-documents';

/** What the sheet shows: a salary (view, then edit in place) or a new one. */
export type SalarySheetTarget = { mode: 'view'; id: string } | { mode: 'create' };

/** The form's values; the amount is the text as typed (`parseMoney` reads it on save). */
export type SalaryFormValue = {
  payeeId: string;
  month: string;
  amount: string;
  currency: Currency;
  note: string;
  fileIds: string[];
};

export type SalaryFormErrors = Partial<
  Record<'payeeId' | 'month' | 'amount' | 'note' | 'form', string>
>;

export function emptySalaryValue(payeeId = ''): SalaryFormValue {
  return {
    payeeId,
    month: '',
    amount: '',
    currency: ENABLED_CURRENCIES[0]!,
    note: '',
    fileIds: [],
  };
}

export function fromSalary(salary: SalaryDetail, language: string): SalaryFormValue {
  return {
    payeeId: salary.payeeId,
    month: salary.month,
    amount: amountText(salary.amount.amountMinor, salary.amount.currency, language),
    currency: salary.amount.currency,
    note: salary.note,
    fileIds: salary.files.map((f) => f.id),
  };
}

/** Field errors (`financeOrg.salaries.errors.*`, the amount's from the item form). */
export function validateSalary(
  value: SalaryFormValue,
  t: (key: string) => string,
): SalaryFormErrors {
  const errors: SalaryFormErrors = {};
  if (!value.payeeId) errors.payeeId = t('financeOrg.salaries.errors.adminRequired');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)) {
    errors.month = t('financeOrg.salaries.errors.monthRequired');
  }
  if (!parseMoney(value.amount, value.currency)) {
    errors.amount = t('financeDocuments.form.errors.amountInvalid');
  }
  if (value.note.length > SALARY_LIMITS.note) {
    errors.note = t('financeOrg.salaries.errors.noteTooLong');
  }
  return errors;
}

/** The create body (`validateSalary` passed): the amount in integer cents. */
export function toSalaryBody(value: SalaryFormValue): SalaryBody {
  return {
    payeeId: value.payeeId,
    month: value.month,
    amount: parseMoney(value.amount, value.currency)!,
    note: value.note,
    fileIds: value.fileIds,
  };
}

/** The changed fields of an edit, with the `updatedAt` it started from. */
export function toSalaryPatch(salary: SalaryDetail, value: SalaryFormValue): SalaryPatch {
  const patch: SalaryPatch = { updatedAt: salary.updatedAt };
  if (value.payeeId !== salary.payeeId) patch.payeeId = value.payeeId;
  if (value.month !== salary.month) patch.month = value.month;
  const amount = parseMoney(value.amount, value.currency);
  if (
    amount &&
    (amount.amountMinor !== salary.amount.amountMinor || amount.currency !== salary.amount.currency)
  ) {
    patch.amount = amount;
  }
  if (value.note !== salary.note) patch.note = value.note;
  const files = salary.files.map((f) => f.id);
  if (JSON.stringify(value.fileIds) !== JSON.stringify(files)) patch.fileIds = value.fileIds;
  return patch;
}

/**
 * One salary in a `SheetDialog` (lazy chunk, 2026-10-21): its admin, month, amount, note,
 * files and linked documents; **Upraviť** edits it in place (a stale edit answers "Someone
 * changed this meanwhile" with "Load their version"), **Vymazať** asks inline first. Also the
 * create form. Needs the `financeDocuments`, `financeOrg` and `forms` namespaces.
 */
export function SalarySheet({
  target,
  defaultPayee,
  onClose,
  onUnavailable,
}: {
  target: SalarySheetTarget;
  /** A new salary's admin: the Mzdy view's admin filter. */
  defaultPayee?: string | null;
  onClose: (createdId?: string) => void;
  onUnavailable: () => void;
}) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const client = useQueryClient();
  const isNew = target.mode === 'create';
  const query = useQuery({
    ...salaryQuery(target.mode === 'view' ? target.id : ''),
    enabled: !isNew,
  });
  const salary = query.data;
  const payees = useQuery(financePayeesQuery).data ?? [];
  const [editing, setEditing] = useState(isNew);
  const [value, setValue] = useState<SalaryFormValue>(() => emptySalaryValue(defaultPayee ?? ''));
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [errors, setErrors] = useState<SalaryFormErrors>({});
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`financeDocuments.sheet.${key}`, options);
  const s = (key: string, options?: Record<string, unknown>) =>
    t(`financeOrg.salaries.${key}`, options);

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const reported = useRef(false);
  useEffect(() => {
    if (!notFound || reported.current) return;
    reported.current = true;
    onUnavailable();
  }, [notFound, onUnavailable]);

  useEffect(() => {
    if (!isNew) titleRef.current?.focus();
  }, [editing, salary?.id, isNew]);

  const refresh = () => void client.invalidateQueries({ queryKey: ['finance', 'all'] });

  function startEdit(source: SalaryDetail) {
    setValue(fromSalary(source, i18n.language));
    setFiles(source.files);
    setErrors({});
    setConflict(false);
    setConfirmDelete(false);
    setEditing(true);
  }

  const stopEditing = () => (isNew ? onClose() : setEditing(false));

  async function save() {
    if (busy || uploading) return;
    const found = validateSalary(value, t);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      if (isNew) {
        const saved = await createSalary(toSalaryBody(value));
        client.setQueryData(salaryQuery(saved.id).queryKey, saved);
        refresh();
        return onClose(saved.id);
      }
      if (!salary) return;
      const patch = toSalaryPatch(salary, value);
      if (Object.keys(patch).length > 1) {
        const saved = await updateSalary(salary.id, patch);
        client.setQueryData(salaryQuery(saved.id).queryKey, saved);
        refresh();
      }
      setEditing(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else setErrors({ form: k('saveFailed') });
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    const fresh = await query.refetch();
    if (fresh.data) startEdit(fresh.data);
  }

  async function remove() {
    if (busy || !salary) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteSalary(salary.id);
      client.removeQueries({ queryKey: salaryQuery(salary.id).queryKey });
      refresh();
      onClose();
    } catch {
      setActionError(k('deleteFailed'));
      setBusy(false);
    }
  }

  const set = <K extends keyof SalaryFormValue>(key: K, next: SalaryFormValue[K]) =>
    setValue((prev) => ({ ...prev, [key]: next }));
  const err = (key: keyof SalaryFormErrors) => ({
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${uid}-${key}-error` : undefined,
  });
  const fieldError = (key: keyof SalaryFormErrors) =>
    errors[key] ? (
      <p id={`${uid}-${key}-error`} className="text-tiny text-error-ink">
        {errors[key]}
      </p>
    ) : null;
  // A removed admin of an old salary stays a choice until the salary is changed.
  const payeeOptions =
    salary && !payees.some((p) => p.id === salary.payeeId)
      ? [...payees, { id: salary.payeeId, name: salary.payeeName }]
      : payees;
  const heading = salary
    ? s('title', { name: salary.payeeName, month: formatMonth(salary.month, i18n.language) })
    : '';

  return (
    <SheetDialog
      onEscape={(event) => {
        event.preventDefault();
        if (confirmDelete) return setConfirmDelete(false);
        if (editing && !isNew) return setEditing(false);
        onClose();
      }}
      initialFocus={titleRef}
      testId="salary-sheet"
      urlOwned
    >
      <PanelHeader onClose={() => onClose()} compactBelow={641} backLabel={k('back')}>
        {!editing && salary && (
          <>
            <Button variant="secondary" size="sm" onClick={() => startEdit(salary)}>
              {k('edit')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              {k('delete')}
            </Button>
          </>
        )}
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:py-5">
        {confirmDelete && (
          <div className="mb-4">
            <PanelNotice text={s('deleteConfirm')}>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                {k('cancel')}
              </Button>
              <Button variant="destructive" onClick={() => void remove()}>
                {k('delete')}
              </Button>
            </PanelNotice>
            {actionError && <p className="mt-2 text-button text-error-ink">{actionError}</p>}
          </div>
        )}
        {conflict && (
          <div className="mb-4">
            <PanelNotice text={k('changed')}>
              <Button variant="outline" onClick={() => void reload()}>
                {k('reload')}
              </Button>
            </PanelNotice>
          </div>
        )}

        {editing ? (
          <div className="flex flex-col gap-5">
            <SheetDialogTitle
              ref={titleRef}
              tabIndex={-1}
              className="break-words text-medium font-semibold outline-none"
            >
              {isNew ? s('new') : heading}
            </SheetDialogTitle>
            <div className="flex flex-col gap-2.5">
              <Label htmlFor={`${uid}-payee`}>{s('admin')}</Label>
              <Select
                id={`${uid}-payee`}
                value={value.payeeId}
                onChange={(event) => set('payeeId', event.target.value)}
                containerClassName="w-full"
                {...err('payeeId')}
              >
                <option value="">{s('chooseAdmin')}</option>
                {payeeOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              {fieldError('payeeId')}
            </div>
            <div className="grid gap-5 min-[641px]:grid-cols-2">
              <div className="flex flex-col gap-2.5">
                <Label htmlFor={`${uid}-month`}>{s('month')}</Label>
                <Input
                  id={`${uid}-month`}
                  type="month"
                  value={value.month}
                  onChange={(event) => set('month', event.target.value)}
                  {...err('month')}
                />
                {fieldError('month')}
              </div>
              <div className="flex flex-col gap-2.5">
                <Label htmlFor={`${uid}-amount`}>{s('amount')}</Label>
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
                  <span className="text-button font-semibold">{value.currency}</span>
                </div>
                {fieldError('amount')}
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              <Label htmlFor={`${uid}-note`}>
                {s('note')}{' '}
                <span className="font-medium text-muted-foreground">
                  ({t('financeDocuments.form.optional')})
                </span>
              </Label>
              <textarea
                id={`${uid}-note`}
                value={value.note}
                rows={3}
                onChange={(event) => set('note', event.target.value)}
                className="min-h-24 w-full rounded-md border-2 border-input bg-card px-[18px] py-[13px] text-button text-foreground focus:border-foreground"
                {...err('note')}
              />
              {fieldError('note')}
            </div>
            <div className="flex flex-col gap-2.5">
              <span id={`${uid}-files`} className="text-button font-semibold">
                {s('files')}
              </span>
              <FilesField
                groupId=""
                uploadPath={financeUploadPath(ORG_OWNER)}
                fileIds={value.fileIds}
                files={files}
                onAdd={(file) => {
                  setFiles((list) => [...list, file]);
                  setValue((prev) => ({ ...prev, fileIds: [...prev.fileIds, file.id] }));
                }}
                onRemove={(id) => {
                  setFiles((list) => list.filter((f) => f.id !== id));
                  setValue((prev) => ({ ...prev, fileIds: prev.fileIds.filter((x) => x !== id) }));
                }}
                labelId={`${uid}-files`}
                max={SALARY_LIMITS.filesPerSalary}
                inputTestId="salary-file-input"
                onPendingChange={setUploading}
              />
            </div>
            {errors.form && (
              <p role="alert" className="text-button text-error-ink">
                {errors.form}
              </p>
            )}
          </div>
        ) : salary ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <SheetDialogTitle
                ref={titleRef}
                tabIndex={-1}
                className="break-words text-medium font-semibold outline-none"
              >
                {heading}
              </SheetDialogTitle>
              <p className="text-tiny text-muted-foreground">
                {k('added', {
                  name: salary.createdByName,
                  date: formatCreated(salary.createdAt, i18n.language),
                })}
              </p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg bg-muted p-4 text-button">
              <dt className="text-muted-foreground">{s('amount')}</dt>
              <dd className="text-medium font-semibold tabular-nums">
                {formatMoney(salary.amount, i18n.language)}
              </dd>
              <dt className="text-muted-foreground">{s('admin')}</dt>
              <dd>{salary.payeeName}</dd>
              <dt className="text-muted-foreground">{s('month')}</dt>
              <dd>{formatMonth(salary.month, i18n.language)}</dd>
            </dl>
            {salary.note.trim() !== '' && (
              <section className="flex flex-col gap-2">
                <h3 className="text-button font-semibold">{s('note')}</h3>
                <p className="text-button break-words whitespace-pre-wrap">{salary.note}</p>
              </section>
            )}
            <section className="flex flex-col gap-2">
              <h3 className="text-button font-semibold">{s('files')}</h3>
              {salary.files.length > 0 ? (
                <div className="flex flex-wrap items-start gap-2">
                  {salary.files.map((file) => (
                    <FileChip key={file.id} file={file} />
                  ))}
                </div>
              ) : (
                <p className="text-tiny text-muted-foreground">
                  {t('financeDocuments.view.noFiles')}
                </p>
              )}
            </section>
            <LinkedDocuments
              target={{ kind: 'salary', id: salary.id }}
              documents={salary.documents}
              onChanged={() => {
                void query.refetch();
                refresh();
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <SheetDialogTitle ref={titleRef} tabIndex={-1} className="sr-only">
              {k('loading')}
            </SheetDialogTitle>
            {query.isError && !notFound ? (
              <>
                <p className="text-button text-error-ink">{k('loadFailed')}</p>
                <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                  {k('retry')}
                </Button>
              </>
            ) : (
              <p role="status" className="text-button text-muted-foreground">
                {k('loading')}
              </p>
            )}
          </div>
        )}
      </div>

      {editing && (
        <footer className="flex items-center justify-end gap-2 border-t-2 border-border px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:pb-4">
          <Button variant="outline" size="lg" className="px-5" onClick={stopEditing}>
            {k('cancel')}
          </Button>
          {uploading && (
            <p role="status" className="text-tiny text-muted-foreground">
              {t('forms.files.waiting')}
            </p>
          )}
          <Button
            size="lg"
            aria-disabled={busy || uploading}
            className="px-5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => void save()}
          >
            {isNew ? k('create') : k('save')}
          </Button>
        </footer>
      )}
    </SheetDialog>
  );
}
