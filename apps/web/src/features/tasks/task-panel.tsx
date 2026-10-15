import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  BoardEvents,
  TaskDtoSchema,
  type BoardDto,
  type BoardTaskDeletedEvent,
  type BoardTaskEvent,
  type FileInfo,
  type TaskDetailDto,
  type TaskDraft,
} from '@spolu/shared';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { groupQuery } from '@/features/groups/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { boardQuery, deleteTask, moveTask, taskQuery, updateTask } from './api';
import { removeTask, showBoardNotice, upsertTask } from './board-cache';
import { bucketTitle, tasksByBucket } from './board-model';
import { formatCreated } from './dates';
import { MoreIcon } from './icons';
import { SourceMessage } from './source-message';
import { TaskForm, validateTaskDraft, type TaskFormErrors } from './task-form';

const toDraft = (task: TaskDetailDto): TaskDraft => ({
  title: task.title,
  description: task.description,
  assigneeIds: task.assignees.map((p) => p.id),
  dueDate: task.dueDate,
  urgent: task.urgent,
  fileIds: task.files.map((f) => f.id),
});

const sameDraft = (a: TaskDraft, b: TaskDraft) =>
  a.title === b.title &&
  a.description === b.description &&
  a.dueDate === b.dueDate &&
  a.urgent === b.urgent &&
  a.assigneeIds.join() === b.assigneeIds.join() &&
  a.fileIds.join() === b.fileIds.join();

/** Route component: reads the ids from the URL. */
export function TaskPanelRoute() {
  const { groupId, taskId } = useParams({ strict: false });
  return groupId && taskId ? <TaskPanel groupId={groupId} taskId={taskId} /> : null;
}

/**
 * The task panel over the board: 560 px on the right from 1024 px, full screen below.
 * `children` is the slot under the form (the task chat, later).
 */
export function TaskPanel({
  groupId,
  taskId,
  children,
}: {
  groupId: string;
  taskId: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery(taskQuery(taskId));
  const task = query.data;
  const gone =
    (query.error instanceof ApiError && query.error.status === 404) ||
    (task !== undefined && task.groupId !== groupId);

  // Gone, foreign or unreadable: back to the board, which says so.
  useEffect(() => {
    if (!gone) return;
    showBoardNotice(queryClient, groupId, 'taskDeleted');
    void navigate({ to: '/groups/$groupId/tasks', params: { groupId }, replace: true });
  }, [gone, groupId, navigate, queryClient]);

  let body: ReactNode = null;
  if (task && !gone) {
    body = (
      <TaskEditor
        key={taskId}
        groupId={groupId}
        initial={task}
        reload={async () => (await query.refetch()).data}
      >
        {children}
      </TaskEditor>
    );
  } else if (query.isError && !gone) {
    body = (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-body text-error-ink">
          {t('tasks.panel.loadFailed')}
        </p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t('tasks.board.retry')}
        </Button>
      </div>
    );
  } else if (!gone) {
    body = (
      <p role="status" className="p-6 text-body text-muted-foreground">
        {t('tasks.panel.loading')}
      </p>
    );
  }

  return (
    <aside
      aria-label={t('tasks.panel.label')}
      className="fixed inset-0 z-40 flex flex-col bg-background lg:left-auto lg:w-[560px] lg:border-l-2 lg:border-border"
    >
      {body}
    </aside>
  );
}

function TaskEditor({
  groupId,
  initial,
  reload,
  children,
}: {
  groupId: string;
  initial: TaskDetailDto;
  reload: () => Promise<TaskDetailDto | undefined>;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useSession();
  const { data: board } = useQuery(boardQuery(groupId));
  const { data: group } = useQuery(groupQuery(groupId));

  // `base` is the version the draft was started from; saving sends its `updatedAt`.
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState<TaskDraft>(() => toDraft(initial));
  const [files, setFiles] = useState<FileInfo[]>(initial.files);
  const [errors, setErrors] = useState<TaskFormErrors>({});
  const [stale, setStale] = useState<{ by: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moveFailed, setMoveFailed] = useState(false);

  const dirty = !sameDraft(draft, toDraft(base));
  const latest = useRef({ dirty, base });
  const leaving = useRef(false);
  useEffect(() => {
    latest.current = { dirty, base };
  });

  const blocker = useBlocker({
    shouldBlockFn: () => latest.current.dirty && !leaving.current,
    withResolver: true,
  });

  const applyVersion = (next: TaskDetailDto) => {
    setBase(next);
    setDraft(toDraft(next));
    setFiles(next.files);
    setErrors({});
    setStale(null);
  };
  const doReload = async () => {
    const fresh = await reload();
    if (fresh) applyVersion(fresh);
  };

  const backToBoard = (replace = false) => {
    leaving.current = true;
    void navigate({ to: '/groups/$groupId/tasks', params: { groupId }, replace });
  };
  const close = () => void navigate({ to: '/groups/$groupId/tasks', params: { groupId } });

  // Live: someone else changed or deleted this task.
  useEffect(() => {
    const socket = getSocket();
    const onTask = ({ task, actor }: BoardTaskEvent) => {
      if (task.groupId !== groupId || task.id !== latest.current.base.id) return;
      if (actor.id === me?.id || task.updatedAt === latest.current.base.updatedAt) return;
      if (latest.current.dirty) setStale({ by: actor.name });
      else void doReload();
    };
    const onDeleted = (event: BoardTaskDeletedEvent) => {
      if (event.groupId !== groupId || event.taskId !== latest.current.base.id) return;
      showBoardNotice(queryClient, groupId, 'taskDeleted');
      backToBoard(true);
    };
    socket.on(BoardEvents.task, onTask);
    socket.on(BoardEvents.taskDeleted, onDeleted);
    return () => {
      socket.off(BoardEvents.task, onTask);
      socket.off(BoardEvents.taskDeleted, onDeleted);
    };
    // Handlers read everything through refs and stable helpers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, me?.id]);

  const syncBoard = (next: TaskDetailDto) => {
    queryClient.setQueryData(taskQuery(next.id).queryKey, next);
    const card = TaskDtoSchema.parse(next);
    queryClient.setQueryData<BoardDto>(
      boardQuery(groupId).queryKey,
      (b) => b && upsertTask(b, card),
    );
  };

  async function save() {
    if (busy) return;
    const found = validateTaskDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const saved = await updateTask(base.id, { ...draft, updatedAt: base.updatedAt });
      syncBoard(saved);
      applyVersion(saved);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'task_changed') {
        setStale({ by: null });
      } else if (error instanceof ApiError && error.code === 'invalid_assignee') {
        setErrors({ assigneeIds: t('tasks.form.errors.invalidAssignee') });
      } else {
        setErrors({ form: t('tasks.board.error') });
      }
    } finally {
      setBusy(false);
    }
  }

  async function onBucket(bucketId: string) {
    if (!board || bucketId === bucketOf?.id) return;
    setMoveFailed(false);
    const last = tasksByBucket(board).get(bucketId)?.at(-1);
    try {
      const moved = await moveTask(base.id, { bucketId, afterTaskId: last?.id ?? null });
      queryClient.setQueryData<BoardDto>(
        boardQuery(groupId).queryKey,
        (b) => b && upsertTask(b, moved),
      );
    } catch {
      setMoveFailed(true);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await deleteTask(base.id);
      queryClient.setQueryData<BoardDto>(
        boardQuery(groupId).queryKey,
        (b) => b && removeTask(b, base.id),
      );
      queryClient.removeQueries({ queryKey: taskQuery(base.id).queryKey });
      backToBoard(true);
    } catch {
      setErrors({ form: t('tasks.board.error') });
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  // The bucket comes from the board cache: a move does not change the task's updatedAt.
  const cardNow = board?.tasks.find((c) => c.id === base.id);
  const bucketOf = board?.buckets.find((b) => b.id === cardNow?.bucketId);
  const canDelete = me !== null && (isAdmin(me) || base.createdBy.id === me.id);

  return (
    <>
      <header className="flex items-center gap-2 border-b-2 border-border px-4 py-3">
        <Button variant="ghost" onClick={close} className="lg:hidden">
          {t('tasks.panel.back')}
        </Button>
        <Button variant="ghost" onClick={close} className="max-lg:hidden">
          {t('tasks.panel.close')}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="task-bucket" className="sr-only">
            {t('tasks.panel.bucket')}
          </label>
          <select
            id="task-bucket"
            value={bucketOf?.id ?? ''}
            disabled={!board || !bucketOf}
            onChange={(event) => void onBucket(event.target.value)}
            className="h-[38px] max-w-52 rounded-full border-2 border-input bg-card px-4 text-button font-semibold text-foreground focus:border-foreground"
          >
            {board?.buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {bucketTitle(t, b, group?.name ?? '')}
              </option>
            ))}
          </select>
          {canDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('tasks.panel.more')}
                className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent"
              >
                <MoreIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => setConfirmDelete(true)}
                  className="text-error-ink"
                >
                  {t('tasks.panel.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        {blocker.status === 'blocked' && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary p-3"
          >
            <p className="mr-auto text-button font-semibold">{t('tasks.panel.unsaved')}</p>
            <Button size="sm" variant="destructive" onClick={blocker.proceed}>
              {t('tasks.panel.discard')}
            </Button>
            <Button size="sm" variant="outline" onClick={blocker.reset}>
              {t('tasks.panel.keepEditing')}
            </Button>
          </div>
        )}
        {confirmDelete && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary p-3"
          >
            <p className="mr-auto text-button font-semibold">{t('tasks.panel.deleteConfirm')}</p>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
              {t('tasks.panel.delete')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>
              {t('tasks.panel.cancel')}
            </Button>
          </div>
        )}
        {stale && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary p-3"
          >
            <p className="mr-auto text-button font-semibold">
              {stale.by
                ? t('tasks.panel.changedBy', { name: stale.by })
                : t('tasks.panel.changedBySomeone')}
            </p>
            <Button size="sm" variant="outline" onClick={() => void doReload()}>
              {t('tasks.panel.reload')}
            </Button>
          </div>
        )}
        {moveFailed && (
          <p role="alert" className="text-button text-error-ink">
            {t('tasks.board.moveFailed')}
          </p>
        )}

        {base.sourceMessage && <SourceMessage groupId={groupId} message={base.sourceMessage} />}

        <TaskForm
          value={draft}
          onChange={setDraft}
          groupId={groupId}
          errors={errors}
          files={files}
          onFilesChange={setFiles}
          knownPeople={base.assignees}
        />

        {dirty && (
          <div className="flex gap-3">
            <Button disabled={busy} onClick={() => void save()}>
              {t('tasks.panel.save')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(toDraft(base));
                setFiles(base.files);
                setErrors({});
              }}
            >
              {t('tasks.panel.cancel')}
            </Button>
          </div>
        )}

        {children}
      </div>

      <footer className="border-t-2 border-border px-6 py-3 text-tiny text-muted-foreground">
        {t('tasks.panel.createdBy', {
          name: base.createdBy.name,
          date: formatCreated(base.createdAt, i18n.language),
        })}
      </footer>
    </>
  );
}
