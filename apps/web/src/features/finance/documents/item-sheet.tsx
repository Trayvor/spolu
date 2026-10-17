import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatMoney,
  type FileInfo,
  type FinanceItemDetail,
  type FinanceItemType,
} from '@spolu/shared';
import { MoreIcon } from '@/components/icons';
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
import { useGroupPeople } from '@/features/groups/use-group-people';
import { putReminderSet } from '@/features/reminders/api';
import { MoveDialog } from '@/features/knowledge/move-dialog';
import { formatCreated } from '@/features/tasks/dates';
import { financeViewKey } from '../api';
import {
  createFinanceItem,
  deleteFinanceItem,
  financeFoldersQuery,
  financeItemQuery,
  updateFinanceItem,
} from './api';
import { FinanceReminders } from './finance-reminders';
import { formatPeriod, hasEnded, isEndingSoon, today } from './format';
import {
  ItemForm,
  emptyItemValue,
  fromItem,
  timesToSave,
  toBody,
  toPatch,
  validateItem,
  type ItemFormErrors,
  type ItemFormValue,
} from './item-form';

export type ItemSheetTarget =
  { mode: 'view'; id: string } | { mode: 'create'; type: FinanceItemType };

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
 * One finance item in a `SheetDialog` (lazy chunk): read it, edit it in place, move it, delete
 * it, or create one. A contract shows its number, amount and period, and its reminders (edited
 * on their own); a new contract saves its proposed reminder right after the item. A missing item
 * (404) calls `onUnavailable`; after a create `onClose` gets the new id.
 */
export function ItemSheet({
  groupId,
  target,
  folderId,
  onClose,
  onUnavailable,
}: {
  groupId: string;
  target: ItemSheetTarget;
  /** Where a new item goes (null: the top level). */
  folderId: string | null;
  onClose: (createdId?: string) => void;
  onUnavailable: () => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const viewId = target.mode === 'view' ? target.id : '';
  const query = useQuery({ ...financeItemQuery(groupId, viewId), enabled: target.mode === 'view' });
  const item = query.data;
  const people = useGroupPeople(groupId).data;
  const folders = useQuery(financeFoldersQuery(groupId)).data;
  const type: FinanceItemType | undefined = target.mode === 'create' ? target.type : item?.type;

  const [editing, setEditing] = useState(target.mode === 'create');
  const [initial, setInitial] = useState<ItemFormValue>(emptyItemValue);
  const [value, setValue] = useState<ItemFormValue>(initial);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [errors, setErrors] = useState<ItemFormErrors>({});
  const [conflict, setConflict] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
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

  const refreshLists = () =>
    void client.invalidateQueries({ queryKey: financeViewKey({ kind: 'group', groupId }) });

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

  async function save() {
    if (busy || !type) return;
    const found = validateItem(type, value, t);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      if (target.mode === 'create') {
        const saved = await createFinanceItem(groupId, toBody(type, value, folderId));
        const times = type === 'contract' ? timesToSave(value.times) : [];
        // The proposed reminder; a failure leaves the item without it (its view offers "Add").
        if (times.length > 0) {
          await putReminderSet('finance', saved.id, { times, baseTimeIds: [] }).catch(
            () => undefined,
          );
        }
        client.setQueryData(financeItemQuery(groupId, saved.id).queryKey, saved);
        refreshLists();
        leaving.current = true;
        return onClose(saved.id);
      }
      if (!item) return;
      const patch = toPatch(item, value);
      if (Object.keys(patch).length === 1) return leave('view');
      const saved = await updateFinanceItem(item.id, patch);
      client.setQueryData(financeItemQuery(groupId, saved.id).queryKey, saved);
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
      client.removeQueries({ queryKey: financeItemQuery(groupId, item.id).queryKey });
      refreshLists();
      onClose();
    } catch {
      setActionError(k('deleteFailed'));
      setBusy(false);
    }
  }

  const nameOf = (id: string) => people?.find((p) => p.id === id)?.name;

  return (
    <SheetDialog onEscape={onEscape} initialFocus={titleRef} testId="finance-item-sheet" urlOwned>
      <PanelHeader onClose={() => request('close')} compactBelow={641} backLabel={k('back')}>
        {!editing && item && (
          <>
            <Button variant="secondary" size="sm" onClick={() => startEdit(item)}>
              {k('edit')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={k('more')}
                className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent"
              >
                <MoreIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
              {target.mode === 'create' ? k(`new.${type}`) : item?.title}
            </SheetDialogTitle>
            <ItemForm
              type={type}
              groupId={groupId}
              value={value}
              onChange={setValue}
              errors={errors}
              files={files}
              onFilesChange={setFiles}
              isNew={target.mode === 'create'}
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
            titleRef={titleRef}
            nameOf={nameOf}
            onGone={onUnavailable}
            language={i18n.language}
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
              <p className="mr-auto text-button font-semibold">
                {target.mode === 'create' ? k('discardDraft') : k('discardChanges')}
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
                onClick={() => request(target.mode === 'create' ? 'close' : 'view')}
              >
                {k('cancel')}
              </Button>
              <Button
                size="lg"
                aria-disabled={busy}
                className="px-5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={() => void save()}
              >
                {target.mode === 'create' ? k('create') : k('save')}
              </Button>
            </div>
          )}
        </footer>
      )}
      {ask?.kind === 'move' && item && (
        <MoveDialog
          folders={folders}
          name={item.title}
          currentFolderId={item.folderId}
          clientItemMessage={t('knowledge.folders.moveFailed')}
          onMove={async (next) => {
            const saved = await updateFinanceItem(item.id, {
              folderId: next,
              updatedAt: item.updatedAt,
            });
            client.setQueryData(financeItemQuery(groupId, saved.id).queryKey, saved);
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
  titleRef,
  nameOf,
  onGone,
  language,
}: {
  item: FinanceItemDetail;
  titleRef: RefObject<HTMLHeadingElement | null>;
  nameOf: (id: string) => string | undefined;
  onGone: () => void;
  language: string;
}) {
  const { t } = useTranslation();
  const v = (key: string) => t(`financeDocuments.view.${key}`);
  const c = item.contract;
  const day = today();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <SheetDialogTitle
          ref={titleRef}
          tabIndex={-1}
          className="break-words text-medium font-semibold outline-none"
        >
          {item.title}
        </SheetDialogTitle>
        <p className="text-tiny text-muted-foreground">
          {t('financeDocuments.sheet.added', {
            name: item.createdByName,
            date: formatCreated(item.createdAt, language),
          })}
        </p>
      </div>
      {c && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg bg-muted p-4 text-button">
          <dt className="text-muted-foreground">{v('amount')}</dt>
          <dd className="text-medium font-semibold tabular-nums">
            {formatMoney(c.amount, language)}
          </dd>
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
      {c && <FinanceReminders itemId={item.id} endsOn={c.endsOn} onGone={onGone} />}
    </div>
  );
}
