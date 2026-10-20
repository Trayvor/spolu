import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useBlocker } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatMoney,
  type FileInfo,
  type FinanceItemDetail,
  type FinanceItemType,
  type GroupPerson,
} from '@spolu/shared';
import { MoreIcon } from '@/components/icons';
import { DismissButton } from '@/components/ui/panel-notice';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PanelHeader } from '@/components/ui/panel-header';
import { PanelNotice } from '@/components/ui/panel-notice';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { ApiError } from '@/lib/api';
import { MessageBody } from '@/features/chat/format/render';
import { FileChip } from '@/features/files/file-chip';
import { ImagePreview } from '@/features/files/image-preview';
import { groupPeopleQuery, groupsQuery, onlyClientGroups } from '@/features/groups/api';
import { putReminderSet } from '@/features/reminders/api';
import { MoveDialog } from '@/features/knowledge/move-dialog';
import { formatCreated } from '@/features/tasks/dates';
import {
  createFinanceItem,
  createOrgItem,
  deleteFinanceItem,
  financeFoldersQuery,
  financeItemQuery,
  financePeopleQuery,
  ownerViewKey,
  updateFinanceItem,
  type FinanceOwner,
} from './api';
import { FinanceReminders } from './finance-reminders';
import {
  formatDay,
  formatPeriod,
  hasEnded,
  isEndingSoon,
  itemTitle,
  proposedExpenseReminder,
  proposedReminder,
  today,
} from './format';
import {
  ItemForm,
  emptyItemValue,
  fromItem,
  timesToSave,
  toBody,
  toOrgBody,
  toPatch,
  validateItem,
  type ItemFormContext,
  type ItemFormErrors,
  type ItemFormValue,
} from './item-form';
import { AuditHistoryItem } from '@/features/audit/history-item';
import { SALARIES_KEY } from '../salaries/api';
import { LinkedCosts, LinkedDocuments } from '../salaries/linked-documents';

export type ItemSheetTarget =
  { mode: 'view'; id: string } | { mode: 'create'; type: FinanceItemType };

/** Where a created item went: its id, and its client (null: the organisation's). */
export type CreatedItem = { id: string; groupId: string | null };

type Ask =
  { kind: 'discard'; then: 'close' | 'view' } | { kind: 'delete' } | { kind: 'move' } | null;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Attachments({ files }: { files: FileInfo[] }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {files.map((file) =>
        file.mime.startsWith('image/') ? (
          <ImagePreview
            key={file.id}
            file={file}
            maxWidth={
              file.width && file.height ? Math.min(320, (240 * file.width) / file.height) : 320
            }
          />
        ) : (
          <FileChip key={file.id} file={file} />
        ),
      )}
    </div>
  );
}

/**
 * The people a description's mentions are named from: the client's, or on `/finance` (the
 * organisation has no group, Phase 32 E) the finance admins.
 */
function useMentionPeople(owner: FinanceOwner): GroupPerson[] | undefined {
  const group = useQuery({
    ...groupPeopleQuery(owner.kind === 'group' ? owner.groupId : ''),
    enabled: owner.kind === 'group',
  }).data;
  const finance = useQuery({ ...financePeopleQuery, enabled: owner.kind === 'org' }).data;
  return useMemo(
    () =>
      owner.kind === 'group'
        ? group
        : finance?.map((p) => ({ ...p, isAdmin: true, isManager: true })),
    [owner.kind, group, finance],
  );
}

/**
 * One finance item in a `SheetDialog` (lazy chunk): read it, edit it in place, move it, delete
 * it, or create one. A contract shows its number, amount and period, and its reminders (edited
 * on their own); a new contract saves its proposed reminder right after the item. Since Phase 32
 * E the owner is a client or the organisation (`/finance`): there an expense (a payment of the
 * organisation, with its linked documents since 2026-10-21) and a contract of several clients (a payer and the shares) are made and
 * edited, and a new item may go to one client. In a client's tab a contract of several clients
 * is read-only, with that client's share, the whole amount and the payer, and a link to
 * `/finance` (decisions O2, E10). A missing item (404) calls `onUnavailable`; after a create
 * `onClose` gets where the item went.
 */
export function ItemSheet({
  owner,
  target,
  folderId,
  onClose,
  onUnavailable,
}: {
  owner: FinanceOwner;
  target: ItemSheetTarget;
  /** Where a new item goes (null: the top level). */
  folderId: string | null;
  onClose: (created?: CreatedItem) => void;
  onUnavailable: () => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const viewId = target.mode === 'view' ? target.id : '';
  const query = useQuery({ ...financeItemQuery(owner, viewId), enabled: target.mode === 'view' });
  const item = query.data;
  const people = useMentionPeople(owner);
  const folders = useQuery(financeFoldersQuery(owner)).data;
  const org = owner.kind === 'org';
  const groups = useQuery({ ...groupsQuery, enabled: org, select: onlyClientGroups }).data;
  const type: FinanceItemType | undefined = target.mode === 'create' ? target.type : item?.type;
  // A contract of several clients is edited on `/finance` only (decision O2).
  const readOnly = !org && item?.contract?.shared != null;
  const context: ItemFormContext = {
    owner,
    ...(org ? { clients: groups ?? [] } : {}),
    ...(people ? { people } : {}),
  };

  const [editing, setEditing] = useState(target.mode === 'create');
  // A contract made on `/finance` belongs to one client or several (decision E13).
  const [initial, setInitial] = useState<ItemFormValue>(() => ({
    ...emptyItemValue(),
    ...(org && target.mode === 'create' && target.type === 'contract'
      ? { owner: 'client' as const }
      : {}),
  }));
  const [value, setValue] = useState<ItemFormValue>(initial);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [errors, setErrors] = useState<ItemFormErrors>({});
  const [conflict, setConflict] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`financeDocuments.sheet.${key}`, options);

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const reported = useRef(false);
  useEffect(() => {
    if (!notFound || reported.current) return;
    reported.current = true;
    onUnavailable();
  }, [notFound, onUnavailable]);

  const shownId = item?.id;
  useEffect(() => {
    if (target.mode === 'create') return;
    titleRef.current?.focus();
  }, [editing, shownId, target.mode]);

  const dirty = editing && !same(value, initial);
  // Back (or any route change) with unsaved edits asks first, like Close does.
  const leaving = useRef(false);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  });
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      (next.pathname !== current.pathname ||
        (next.search as Record<string, unknown>).item !==
          (current.search as Record<string, unknown>).item) &&
      dirtyRef.current &&
      !leaving.current,
    enableBeforeUnload: () => dirtyRef.current && !leaving.current,
    withResolver: true,
  });

  const refreshLists = () => void client.invalidateQueries({ queryKey: ownerViewKey(owner) });

  function startEdit(source: FinanceItemDetail) {
    const next = fromItem(source, i18n.language);
    setInitial(next);
    setValue(next);
    setFiles(source.files);
    setErrors({});
    setConflict(false);
    setActionError(null);
    setAsk(null);
    setEditing(true);
  }

  function leave(then: 'close' | 'view') {
    setAsk(null);
    if (then === 'close' || target.mode === 'create') {
      leaving.current = true;
      return onClose();
    }
    setEditing(false);
    setErrors({});
    setConflict(false);
  }
  const request = (then: 'close' | 'view') =>
    dirty ? setAsk({ kind: 'discard', then }) : leave(then);

  function onEscape(event: KeyboardEvent) {
    event.preventDefault();
    if (ask) return setAsk(null);
    request(editing && target.mode === 'view' ? 'view' : 'close');
  }

  const isNew = target.mode === 'create';
  const shared =
    type === 'contract' &&
    (isNew ? org && value.owner === 'shared' : item?.contract?.shared != null);

  async function create(createType: FinanceItemType): Promise<FinanceItemDetail> {
    if (owner.kind === 'group') {
      return createFinanceItem(owner.groupId, toBody(createType, value, folderId));
    }
    // On `/finance` a contract, document or note may go to one client (decision E13), into its
    // top level; anything else is the organisation's.
    if (value.owner === 'client' && createType !== 'expense') {
      return createFinanceItem(value.clientId, toBody(createType, value, null));
    }
    return createOrgItem(toOrgBody(createType, value, folderId));
  }

  async function save() {
    if (busy || uploading || !type) return;
    const found = validateItem(type, value, t, { shared, isNew });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      if (isNew) {
        const saved = await create(type);
        const times = type === 'contract' || type === 'expense' ? timesToSave(value.times) : [];
        // The proposed reminder; a failure leaves the item without it (its view offers "Add").
        if (times.length > 0) {
          await putReminderSet('finance', saved.id, { times, baseTimeIds: [] }).catch(
            () => undefined,
          );
        }
        if (saved.groupId === null || owner.kind === 'group') {
          client.setQueryData(financeItemQuery(owner, saved.id).queryKey, saved);
        }
        refreshLists();
        if (saved.groupId !== null) {
          void client.invalidateQueries({ queryKey: ['finance', saved.groupId] });
        }
        leaving.current = true;
        return onClose({ id: saved.id, groupId: saved.groupId });
      }
      if (!item) return;
      const patch = toPatch(item, value);
      if (Object.keys(patch).length === 1) return leave('view');
      const saved = await updateFinanceItem(item.id, patch);
      client.setQueryData(financeItemQuery(owner, saved.id).queryKey, saved);
      refreshLists();
      leave('view');
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
    if (busy || !item) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteFinanceItem(item.id);
      client.removeQueries({ queryKey: financeItemQuery(owner, item.id).queryKey });
      refreshLists();
      onClose();
    } catch {
      setActionError(k('deleteFailed'));
      setBusy(false);
    }
  }

  const nameOf = (id: string) => people?.find((p) => p.id === id)?.name;
  const newTitle =
    type === 'expense' ? t('financeOrg.sheet.newExpense') : type ? k(`new.${type}`) : '';

  return (
    <SheetDialog onEscape={onEscape} initialFocus={titleRef} testId="finance-item-sheet" urlOwned>
      <PanelHeader onClose={() => request('close')} compactBelow={641} backLabel={k('back')}>
        {!editing && item && !readOnly && (
          <>
            <Button variant="secondary" size="sm" onClick={() => startEdit(item)}>
              {k('edit')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={k('more')}
                className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent touch:size-11"
              >
                <MoreIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* Every viewer of a finance item holds the finance right: an admin. */}
                <AuditHistoryItem
                  entityType="finance_item"
                  entityId={item.id}
                  label={item.title}
                  text={t('financeDocuments.menu.history')}
                />
                <DropdownMenuItem onSelect={() => setAsk({ kind: 'move' })}>
                  {k('move')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setAsk({ kind: 'delete' })}
                  className="text-error-ink"
                >
                  {k('delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:py-5">
        {ask?.kind === 'delete' && (
          <div className="mb-4">
            <PanelNotice text={k('deleteConfirm')}>
              <Button variant="ghost" onClick={() => setAsk(null)}>
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

        {editing && type ? (
          <div className="flex flex-col gap-5">
            <SheetDialogTitle
              ref={titleRef}
              tabIndex={-1}
              className="break-words text-medium font-semibold outline-none"
            >
              {isNew ? newTitle : item ? itemTitle(item) : ''}
            </SheetDialogTitle>
            <ItemForm
              type={type}
              context={context}
              value={value}
              onChange={setValue}
              errors={errors}
              files={files}
              onFilesChange={setFiles}
              isNew={isNew}
              onUploadingChange={setUploading}
            />
            {errors.form && (
              <p role="alert" className="text-button text-error-ink">
                {errors.form}
              </p>
            )}
          </div>
        ) : item ? (
          <ItemView
            item={item}
            owner={owner}
            readOnly={readOnly}
            titleRef={titleRef}
            nameOf={nameOf}
            onGone={onUnavailable}
            language={i18n.language}
            onLinksChanged={() => {
              void query.refetch();
              void client.invalidateQueries({ queryKey: SALARIES_KEY });
            }}
          />
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
        <footer className="flex flex-col gap-2 border-t-2 border-border px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:pb-4">
          {ask?.kind === 'discard' || blocker.status === 'blocked' ? (
            <div role="alert" className="flex flex-wrap items-center gap-2">
              <DismissButton
                autoFocus
                onDismiss={() => (blocker.status === 'blocked' ? blocker.reset() : setAsk(null))}
              />
              <p className="mr-auto text-button font-semibold">
                {isNew ? k('discardDraft') : k('discardChanges')}
              </p>
              <Button
                variant="outline"
                size="lg"
                onClick={() => (blocker.status === 'blocked' ? blocker.reset() : setAsk(null))}
              >
                {k('keepEditing')}
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={() => {
                  if (blocker.status === 'blocked') {
                    leaving.current = true;
                    blocker.proceed();
                  } else if (ask?.kind === 'discard') leave(ask.then);
                }}
              >
                {k('discard')}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="lg"
                className="px-5"
                onClick={() => request(isNew ? 'close' : 'view')}
              >
                {k('cancel')}
              </Button>
              {uploading && (
                <p
                  id="finance-upload-wait"
                  role="status"
                  className="text-tiny text-muted-foreground"
                >
                  {t('forms.files.waiting')}
                </p>
              )}
              <Button
                size="lg"
                aria-disabled={busy || uploading}
                aria-describedby={uploading ? 'finance-upload-wait' : undefined}
                className="px-5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={() => void save()}
              >
                {isNew ? k('create') : k('save')}
              </Button>
            </div>
          )}
        </footer>
      )}
      {ask?.kind === 'move' && item && (
        <MoveDialog
          folders={folders}
          name={itemTitle(item)}
          currentFolderId={item.folderId}
          clientItemMessage={t('knowledge.folders.moveFailed')}
          onMove={async (next) => {
            const saved = await updateFinanceItem(item.id, {
              folderId: next,
              updatedAt: item.updatedAt,
            });
            client.setQueryData(financeItemQuery(owner, saved.id).queryKey, saved);
            refreshLists();
            setAsk(null);
          }}
          onClose={() => setAsk(null)}
        />
      )}
    </SheetDialog>
  );
}

function ItemView({
  item,
  owner,
  readOnly,
  titleRef,
  nameOf,
  onGone,
  language,
  onLinksChanged,
}: {
  item: FinanceItemDetail;
  owner: FinanceOwner;
  readOnly: boolean;
  titleRef: RefObject<HTMLHeadingElement | null>;
  nameOf: (id: string) => string | undefined;
  onGone: () => void;
  language: string;
  /** A document was linked or unlinked (an expense's sheet). */
  onLinksChanged: () => void;
}) {
  const { t } = useTranslation();
  const v = (key: string) => t(`financeDocuments.view.${key}`);
  const o = (key: string, options?: Record<string, unknown>) =>
    t(`financeOrg.view.${key}`, options);
  const c = item.contract;
  const e = item.expense;
  const shared = c?.shared ?? null;
  const day = today();
  const money = (amountMinor: number, currency = c?.amount.currency ?? 'EUR') =>
    formatMoney({ amountMinor, currency }, language);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <SheetDialogTitle
          ref={titleRef}
          tabIndex={-1}
          className="break-words text-medium font-semibold outline-none"
        >
          {itemTitle(item)}
        </SheetDialogTitle>
        <p className="text-tiny text-muted-foreground">
          {t('financeDocuments.sheet.added', {
            name: item.createdByName,
            date: formatCreated(item.createdAt, language),
          })}
        </p>
      </div>
      {readOnly && (
        <div className="flex flex-col items-start gap-2 rounded-lg bg-secondary p-4">
          <p className="text-button">{o('readOnly')}</p>
          <Button asChild variant="secondary" size="sm">
            <Link to="/finance" search={{ item: item.id }} data-testid="edit-on-finance">
              {o('editOnFinance')}
            </Link>
          </Button>
        </div>
      )}
      {c && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg bg-muted p-4 text-button">
          {shared && owner.kind === 'group' ? (
            <>
              <dt className="text-muted-foreground">{o('share')}</dt>
              <dd className="text-medium font-semibold tabular-nums" data-testid="share-amount">
                {formatMoney(c.amount, language)}
              </dd>
              <dt className="text-muted-foreground">{o('total')}</dt>
              <dd className="tabular-nums">{formatMoney(shared.total, language)}</dd>
            </>
          ) : (
            <>
              <dt className="text-muted-foreground">{v('amount')}</dt>
              <dd className="text-medium font-semibold tabular-nums">
                {formatMoney(shared?.total ?? c.amount, language)}
              </dd>
            </>
          )}
          {shared && (
            <>
              <dt className="text-muted-foreground">{o('payer')}</dt>
              <dd className="break-words">{shared.payerName}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{v('period')}</dt>
          <dd className="flex flex-wrap items-center gap-2 tabular-nums">
            {formatPeriod(c.startsOn, c.endsOn, language)}
            {isEndingSoon(c.endsOn, day) && (
              <span className="rounded-full bg-attention px-2 text-micro font-semibold text-attention-foreground">
                {t('financeDocuments.row.endingSoon')}
              </span>
            )}
            {hasEnded(c.endsOn, day) && (
              <span className="text-tiny text-muted-foreground">
                {t('financeDocuments.row.ended')}
              </span>
            )}
          </dd>
          {c.contractNumber && (
            <>
              <dt className="text-muted-foreground">{v('number')}</dt>
              <dd className="tabular-nums">{c.contractNumber}</dd>
            </>
          )}
        </dl>
      )}
      {shared && owner.kind === 'org' && (
        <section className="flex flex-col gap-2">
          <h3 className="text-button font-semibold">{o('shares')}</h3>
          <table className="w-full text-button">
            <tbody>
              {shared.shares.map((s) => (
                <tr key={s.groupId} className="border-b border-border last:border-b-0">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    <Link
                      to="/groups/$groupId/finance"
                      params={{ groupId: s.groupId }}
                      className="hover:underline"
                    >
                      {s.groupName}
                    </Link>
                  </th>
                  <td className="py-2 text-right tabular-nums">{money(s.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {e && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg bg-muted p-4 text-button">
          <dt className="text-muted-foreground">{v('amount')}</dt>
          <dd className="text-medium font-semibold tabular-nums">
            {formatMoney(e.amount, language)}
          </dd>
          <dt className="text-muted-foreground">{o('date')}</dt>
          <dd className="flex flex-wrap items-center gap-2 tabular-nums">
            {formatDay(e.spentOn, language)}
            {e.spentOn > day && (
              <span className="text-tiny text-muted-foreground">{o('planned')}</span>
            )}
          </dd>
        </dl>
      )}
      {item.body.trim() !== '' && (
        <section className="flex flex-col gap-2">
          <h3 className="text-button font-semibold">{v('description')}</h3>
          <div className="text-button">
            <MessageBody body={item.body} nameOf={nameOf} />
          </div>
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h3 className="text-button font-semibold">{v('files')}</h3>
        {item.files.length > 0 ? (
          <Attachments files={item.files} />
        ) : (
          <p className="text-tiny text-muted-foreground">{v('noFiles')}</p>
        )}
      </section>
      {e && owner.kind === 'org' && (
        <LinkedDocuments
          target={{ kind: 'expense', id: item.id }}
          documents={item.costDocuments ?? []}
          onChanged={onLinksChanged}
        />
      )}
      {item.type === 'document' && owner.kind === 'org' && (
        <LinkedCosts costs={item.linkedCosts ?? []} />
      )}
      {!readOnly && c && (
        <FinanceReminders itemId={item.id} proposal={proposedReminder(c.endsOn)} onGone={onGone} />
      )}
      {e && (
        <FinanceReminders
          itemId={item.id}
          proposal={proposedExpenseReminder(e.spentOn)}
          onGone={onGone}
        />
      )}
    </div>
  );
}
