import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from '@tanstack/react-router';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { FileInfo, KnowledgeItemDto, KnowledgeType } from '@spolu/shared';
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
import { useSession } from '@/features/auth/use-session';
import { useGroupPeople } from '@/features/groups/use-group-people';
import {
  createKnowledge,
  deleteKnowledge,
  groupFoldersQuery,
  knowledgeItemQuery,
  updateKnowledge,
} from './api';
import {
  KnowledgeForm,
  emptyKnowledgeValue,
  fromItem,
  toDraft,
  toPatch,
  validateKnowledge,
  type KnowledgeFormErrors,
  type KnowledgeFormValue,
} from './knowledge-form';
import { KnowledgeView } from './knowledge-view';
import { MoveDialog } from './move-dialog';

/** `folderId` of a create: the folder the new item goes into (null or absent: the top level). */
export type KnowledgeDialogTarget =
  | { mode: 'view'; id: string }
  | { mode: 'create'; type: KnowledgeType; groupId: string; folderId?: string | null };

type Ask =
  { kind: 'discard'; then: 'close' | 'view' } | { kind: 'delete' } | { kind: 'move' } | null;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The group and global lists refetch after a write; the item itself is written in place. */
function refreshLists(client: QueryClient) {
  void client.invalidateQueries({
    queryKey: ['knowledge'],
    predicate: (query) => query.queryKey[1] === 'group' || query.queryKey[1] === 'global',
  });
}

/** Server error codes of a save, as messages on their fields. */
function saveErrors(error: unknown, t: (key: string) => string): KnowledgeFormErrors {
  const code = error instanceof ApiError ? error.code : undefined;
  switch (code) {
    case 'invalid_url':
      return { url: t('knowledge.form.errors.urlInvalid') };
    case 'reminder_in_past':
      return { times: t('reminders.fields.errors.passed') };
    case 'invalid_recipient':
      return { recipients: t('knowledge.detail.recipientInvalid') };
    default:
      return { form: t('knowledge.detail.saveFailed') };
  }
}

/**
 * One knowledge item in a `SheetDialog` (720 px from 641 px, a full-screen sheet below): read it,
 * edit it in place, delete it, or create a new one. Viewing a missing or unreadable item (404)
 * calls `onUnavailable`. After a create, `onClose` gets the new item's id.
 */
export function KnowledgeDialog({
  target,
  onClose,
  onUnavailable,
}: {
  target: KnowledgeDialogTarget;
  onClose: (createdId?: string) => void;
  onUnavailable: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const me = useSession();
  const viewId = target.mode === 'view' ? target.id : '';
  const query = useQuery({ ...knowledgeItemQuery(viewId), enabled: target.mode === 'view' });
  const item = query.data;
  const groupId = target.mode === 'create' ? target.groupId : (item?.groupId ?? '');
  const people = useGroupPeople(groupId).data;
  const folders = useQuery({ ...groupFoldersQuery(groupId), enabled: groupId !== '' }).data;
  const folderId = target.mode === 'create' ? (target.folderId ?? null) : (item?.folderId ?? null);
  // Inside an admins-only folder everything is admins-only: "Visible to" is locked.
  const inAdminsFolder =
    folderId !== null && folders?.find((f) => f.id === folderId)?.visibility === 'admins';
  const nameOf = (id: string) => people?.find((p) => p.id === id)?.name;

  const [editing, setEditing] = useState(target.mode === 'create');
  const [initial, setInitial] = useState<KnowledgeFormValue>(() => emptyKnowledgeValue());
  const [value, setValue] = useState<KnowledgeFormValue>(initial);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [errors, setErrors] = useState<KnowledgeFormErrors>({});
  const [conflict, setConflict] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const reported = useRef(false);
  useEffect(() => {
    if (!notFound || reported.current) return;
    reported.current = true;
    onUnavailable();
  }, [notFound, onUnavailable]);

  // The title takes the focus once the item shows, and again after Edit, Save or Cancel. A new
  // item's form focuses its title field instead.
  const shownId = item?.id;
  useEffect(() => {
    if (target.mode === 'create') return;
    titleRef.current?.focus();
  }, [editing, shownId, target.mode]);

  const type: KnowledgeType | undefined = target.mode === 'create' ? target.type : item?.type;
  const dirty = editing && !same(value, initial);

  // Browser Back (or any route change) with unsaved edits asks first, like "Close" does. A close
  // the person already confirmed (`leaving`) goes through.
  const leaving = useRef(false);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  });
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      (next.pathname !== current.pathname ||
        (next.search as Record<string, unknown>).k !==
          (current.search as Record<string, unknown>).k) &&
      dirtyRef.current &&
      !leaving.current,
    enableBeforeUnload: () => dirtyRef.current && !leaving.current,
    withResolver: true,
  });

  function startEdit(source: KnowledgeItemDto) {
    const next = fromItem(source);
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

  function request(then: 'close' | 'view') {
    if (dirty) setAsk({ kind: 'discard', then });
    else leave(then);
  }

  function onEscape(event: KeyboardEvent) {
    event.preventDefault();
    if (ask) return setAsk(null);
    request(editing && target.mode === 'view' ? 'view' : 'close');
  }

  async function save() {
    if (busy || !type) return;
    const found = validateKnowledge(type, value);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      let saved: KnowledgeItemDto;
      if (target.mode === 'create') {
        saved = await createKnowledge(
          target.groupId,
          toDraft(type, inAdminsFolder ? { ...value, visibility: 'admins' } : value, {
            people,
            authorId: me?.id,
            folderId,
          }),
        );
      } else {
        if (!item) return;
        const patch = toPatch(item, value, { people });
        if (Object.keys(patch).length === 1) return leave('view');
        saved = await updateKnowledge(item.id, patch);
      }
      client.setQueryData(['knowledge', 'item', saved.id], saved);
      refreshLists(client);
      if (target.mode === 'create') return onClose(saved.id);
      leave('view');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else setErrors(saveErrors(error, t));
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
      await deleteKnowledge(item.id);
      client.removeQueries({ queryKey: ['knowledge', 'item', item.id] });
      refreshLists(client);
      onClose();
    } catch {
      setActionError(t('knowledge.detail.deleteFailed'));
      setBusy(false);
    }
  }

  const canChooseVisibility = me !== null && me.role !== 'client';

  return (
    <SheetDialog onEscape={onEscape} initialFocus={titleRef} testId="knowledge-dialog" urlOwned>
      <PanelHeader
        onClose={() => request('close')}
        compactBelow={641}
        backLabel={t('knowledge.detail.back')}
      >
        {!editing && item?.canEdit && (
          <>
            <Button variant="secondary" size="sm" onClick={() => startEdit(item)}>
              {t('knowledge.detail.edit')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('knowledge.detail.more')}
                className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent"
              >
                <MoreIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setAsk({ kind: 'move' })}>
                  {t('knowledge.folders.moveTo')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setAsk({ kind: 'delete' })}
                  className="text-error-ink"
                >
                  {t('knowledge.detail.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:py-5">
        {ask?.kind === 'delete' && (
          <div className="mb-4">
            <PanelNotice text={t('knowledge.detail.deleteConfirm')}>
              <Button variant="ghost" onClick={() => setAsk(null)}>
                {t('knowledge.detail.cancel')}
              </Button>
              <Button variant="destructive" onClick={() => void remove()}>
                {t('knowledge.detail.delete')}
              </Button>
            </PanelNotice>
            {actionError && <p className="mt-2 text-button text-error-ink">{actionError}</p>}
          </div>
        )}
        {conflict && (
          <div className="mb-4">
            <PanelNotice text={t('knowledge.detail.changed')}>
              <Button variant="outline" onClick={() => void reload()}>
                {t('knowledge.detail.reload')}
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
              {target.mode === 'create' ? t(`knowledge.detail.new.${type}`) : item?.title}
            </SheetDialogTitle>
            <KnowledgeForm
              value={value}
              onChange={setValue}
              groupId={groupId}
              type={type}
              errors={errors}
              files={files}
              onFilesChange={setFiles}
              canChooseVisibility={canChooseVisibility}
              visibilityLocked={item?.visibilityLocked ?? false}
              inAdminsFolder={inAdminsFolder}
              authorId={item?.createdBy.id ?? me?.id ?? ''}
              autoFocusTitle={target.mode === 'create'}
            />
          </div>
        ) : item ? (
          <KnowledgeView
            ref={titleRef}
            item={item}
            nameOf={nameOf}
            onChanged={() => void query.refetch()}
          />
        ) : (
          <div className="flex flex-col items-start gap-3">
            <SheetDialogTitle ref={titleRef} tabIndex={-1} className="sr-only">
              {t('knowledge.detail.loading')}
            </SheetDialogTitle>
            {query.isError && !notFound ? (
              <>
                <p className="text-button text-error-ink">{t('knowledge.detail.loadFailed')}</p>
                <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                  {t('knowledge.detail.retry')}
                </Button>
              </>
            ) : (
              <p role="status" className="text-button text-muted-foreground">
                {t('knowledge.detail.loading')}
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
                {target.mode === 'create'
                  ? t('knowledge.detail.discardDraft')
                  : t('knowledge.detail.discardChanges')}
              </p>
              <Button
                variant="outline"
                size="lg"
                onClick={() => (blocker.status === 'blocked' ? blocker.reset() : setAsk(null))}
              >
                {t('knowledge.detail.keepEditing')}
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
                {t('knowledge.detail.discard')}
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
                {t('knowledge.detail.cancel')}
              </Button>
              <Button
                size="lg"
                // Not `disabled`: a disabled button drops the focus when the request starts.
                aria-disabled={busy}
                className="px-5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={() => void save()}
              >
                {target.mode === 'create'
                  ? t('knowledge.detail.create')
                  : t('knowledge.detail.save')}
              </Button>
            </div>
          )}
        </footer>
      )}
      {ask?.kind === 'move' && item && (
        <MoveDialog
          groupId={item.groupId}
          name={item.title}
          currentFolderId={item.folderId}
          clientItemMessage={t('knowledge.folders.clientItem')}
          onMove={async (next) => {
            const saved = await updateKnowledge(item.id, {
              folderId: next,
              updatedAt: item.updatedAt,
            });
            client.setQueryData(['knowledge', 'item', saved.id], saved);
            refreshLists(client);
            setAsk(null);
          }}
          onClose={() => setAsk(null)}
        />
      )}
    </SheetDialog>
  );
}
