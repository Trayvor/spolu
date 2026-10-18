import { Skeleton } from '@/components/ui/skeleton';
import { useMarkSeen } from '@/lib/use-mark-seen';
import { UnseenBanner, useOpenSummary } from '@/features/unseen/banner';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useLocation, useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  BoardEvents,
  TaskDtoSchema,
  type BoardDto,
  type BoardTaskDeletedEvent,
  type BoardTaskEvent,
  type FileInfo,
  type TaskDetailDto,
  type LinkedKnowledge,
  type TaskDraft,
} from '@spolu/shared';
import { isAdmin } from '@/features/auth/roles';
import { OpenInClaude } from '@/features/open-in-claude/open-in-claude';
import { useSession } from '@/features/auth/use-session';
import { groupPeopleQuery, groupQuery } from '@/features/groups/api';
import { Button } from '@/components/ui/button';
import { PanelHeader } from '@/components/ui/panel-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError } from '@/lib/api';
import { backOr } from '@/lib/back';
import { getSocket } from '@/lib/socket';
import { useUpdateSearch } from '@/lib/use-update-search';
import { cn } from '@/lib/utils';
import { boardQuery, deleteTask, moveTask, taskQuery, updateTask } from './api';
import { taskChatsQuery } from './task-chats';
import { removeTask, showBoardNotice, upsertTask } from './board-cache';
import { doneTarget, tasksByBucket } from './board-model';
import { formatCreated } from './dates';
import { DoneCircle } from './done-circle';
import { MoreIcon } from './icons';
import {
  BucketSelect,
  PanelNotice,
  PanelShell,
  PanelTabs,
  panelTabIds,
  type PanelTab,
} from './panel-parts';
import { SourceMeetingLine, SourceMessage, SourceTicketLine } from './source-message';
import { TaskForm, validateTaskDraft, type TaskFormErrors } from './task-form';
import { TaskReminders } from './task-reminders';
import { seesTime, TaskMyTime } from './my-time';
import { askForTime } from './time-queue';

// The chat (the conversation and, through the composer, ProseMirror) loads only when the Chat tab
// opens: the Details tab never downloads it.
const TaskChat = lazy(() => import('./task-chat').then((m) => ({ default: m.TaskChat })));

const toDraft = (task: TaskDetailDto): TaskDraft => ({
  title: task.title,
  description: task.description,
  assigneeIds: task.assignees.map((p) => p.id),
  dueDate: task.dueDate,
  urgent: task.urgent,
  fileIds: task.files.map((f) => f.id),
  link: task.link,
  knowledgeIds: task.linkedKnowledge.map((k) => k.id),
  projectId: task.project?.id ?? null,
  eventId: task.event?.id ?? null,
});

const sameDraft = (a: TaskDraft, b: TaskDraft) =>
  a.title === b.title &&
  a.description === b.description &&
  a.dueDate === b.dueDate &&
  a.urgent === b.urgent &&
  a.link === b.link &&
  a.assigneeIds.join() === b.assigneeIds.join() &&
  a.fileIds.join() === b.fileIds.join() &&
  (a.knowledgeIds ?? []).join() === (b.knowledgeIds ?? []).join() &&
  (a.projectId ?? null) === (b.projectId ?? null) &&
  (a.eventId ?? null) === (b.eventId ?? null);

/** Route component: reads the ids from the URL. */
export function TaskPanelRoute() {
  const { groupId, taskId } = useParams({ strict: false });
  return groupId && taskId ? <TaskPanel groupId={groupId} taskId={taskId} /> : null;
}

/**
 * The task panel over the board: 560 px on the right from 1024 px, full screen below. Under the
 * title, two tabs: Details (the form) and Chat (the task's chat, `?tab=chat`).
 */
export function TaskPanel({
  groupId,
  taskId,
  onExit,
}: {
  groupId: string;
  taskId: string;
  /**
   * Set where the panel opens over another screen (the global board): close, Escape, back and a
   * deleted task call it instead of going to the group's board (and show no board notice).
   */
  onExit?: (opts: { replace: boolean }) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery(taskQuery(taskId));
  const task = query.data;
  const gone =
    (query.error instanceof ApiError && query.error.status === 404) ||
    (task !== undefined && task.groupId !== groupId);
  // 2026-10-17: open (either tab) and visible, its changes are seen; 2026-10-18: after what
  // changed was fetched for the banner.
  const seenTarget = task && !gone ? ({ kind: 'task', id: taskId } as const) : null;
  const opened = useOpenSummary(seenTarget);
  useMarkSeen(seenTarget, opened.ready);

  // Gone, foreign or unreadable: back to the board, which says so.
  const exit = useRef(onExit);
  useEffect(() => {
    exit.current = onExit;
  });
  useEffect(() => {
    if (!gone) return;
    if (exit.current) {
      exit.current({ replace: true });
      return;
    }
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
        onExit={onExit}
        banner={<UnseenBanner open={opened} />}
        reload={async () => {
          const result = await query.refetch();
          return result.isError ? undefined : result.data;
        }}
      />
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
    // The title, a field and two lines, grey, in the details' own spacing.
    body = (
      <div role="status" className="space-y-5 p-4 min-[641px]:p-6">
        <span className="sr-only">{t('tasks.panel.loading')}</span>
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-11" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  return (
    <PanelShell groupId={groupId} taskId={taskId} onExit={onExit}>
      {body}
    </PanelShell>
  );
}

/** `?tab=chat` shows the Chat tab; anything else, Details. The route declares no search schema. */
function usePanelTab(): [PanelTab, (tab: PanelTab) => void] {
  const updateSearch = useUpdateSearch();
  const tab = useLocation({
    select: (l) => ((l.search as Record<string, unknown>).tab === 'chat' ? 'chat' : 'details'),
  });
  // Replaces the history entry; other params (the chat's `message`, `thread`, `c`) stay.
  const setTab = (next: PanelTab) =>
    updateSearch(
      (search) => {
        if (next === 'chat') search.tab = 'chat';
        else delete search.tab;
      },
      { replace: true },
    );
  return [tab, setTab];
}

/**
 * `?time=1` (the time request's push and email, Phase 32): an admin assignee gets the time
 * dialog over the panel; the param is dropped so Back or a reload does not ask again.
 */
function useTimeParam(task: TaskDetailDto, me: ReturnType<typeof useSession>) {
  const updateSearch = useUpdateSearch();
  const asked = useLocation({ select: (l) => (l.search as Record<string, unknown>).time });
  useEffect(() => {
    if (asked === undefined || !me) return;
    updateSearch(
      (search) => {
        delete search.time;
      },
      { replace: true },
    );
    if (String(asked) === '1' && isAdmin(me) && task.assignees.some((p) => p.id === me.id)) {
      askForTime({ kind: 'task', id: task.id, groupId: task.groupId, title: task.title });
    }
    // Once per arrival of the param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, me?.id]);
}

function TaskEditor({
  groupId,
  initial,
  reload,
  onExit,
  banner,
}: {
  groupId: string;
  initial: TaskDetailDto;
  reload: () => Promise<TaskDetailDto | undefined>;
  onExit?: (opts: { replace: boolean }) => void;
  /** What changed since the viewer last opened the task (2026-10-18), above the notices. */
  banner?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const me = useSession();
  const { data: board } = useQuery(boardQuery(groupId));
  const { data: group } = useQuery(groupQuery(groupId));
  const { data: chats } = useQuery(taskChatsQuery(groupId));

  // `base` is the version the draft was started from; saving sends its `updatedAt`.
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState<TaskDraft>(() => toDraft(initial));
  const [files, setFiles] = useState<FileInfo[]>(initial.files);
  const [linked, setLinked] = useState<LinkedKnowledge>(initial.linkedKnowledge);
  const [errors, setErrors] = useState<TaskFormErrors>({});
  const [uploading, setUploading] = useState(false);
  const [stale, setStale] = useState<{ by: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moveFailed, setMoveFailed] = useState(false);
  const [moving, setMoving] = useState(false);

  const dirty = !sameDraft(draft, toDraft(base));
  const latest = useRef({ dirty, base });
  const leaving = useRef(false);
  const deleting = useRef(false);
  useEffect(() => {
    latest.current = { dirty, base };
  });

  const [tab, setTab] = usePanelTab();
  useTimeParam(initial, me);

  // Leaving the task asks while the draft is unsaved; the tabs and the chat's own params
  // (thread, message) only change the search, so they never ask.
  const blocker = useBlocker({
    // `task` is the panel open over the global board: closing it changes only the search.
    shouldBlockFn: ({ current, next }) =>
      (next.pathname !== current.pathname ||
        (next.search as Record<string, unknown>).task !==
          (current.search as Record<string, unknown>).task) &&
      latest.current.dirty &&
      !leaving.current,
    enableBeforeUnload: () => latest.current.dirty && !leaving.current,
    withResolver: true,
  });

  // The panel's heading takes the focus when it opens.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const applyVersion = (next: TaskDetailDto) => {
    setBase(next);
    setDraft(toDraft(next));
    setFiles(next.files);
    setLinked(next.linkedKnowledge);
    setErrors({});
    setStale(null);
  };
  const doReload = async (silent = false) => {
    const fresh = await reload();
    if (!fresh) {
      setErrors({ form: t('tasks.panel.loadFailed') });
      return;
    }
    // Typing during a silent reload must not be lost: ask instead.
    if (silent && latest.current.dirty) setStale({ by: null });
    else applyVersion(fresh);
  };

  // A newer version arrived through the query (a board event or a rejoin invalidated it):
  // apply it to a clean form, ask when there are unsaved edits.
  useEffect(() => {
    const current = latest.current;
    if (Date.parse(initial.updatedAt) <= Date.parse(current.base.updatedAt)) return;
    if (current.dirty) setStale((s) => s ?? { by: null });
    else applyVersion(initial);
    // Only a new version matters; `applyVersion` only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.updatedAt]);

  const backToBoard = (replace = false) => {
    leaving.current = true;
    if (onExit) onExit({ replace });
    else void navigate({ to: '/groups/$groupId/tasks', params: { groupId }, replace });
  };
  // Closing goes back where the task was opened from (the board, home, a ticket, a chat), so
  // Back does not reopen it; opened from a link from outside, it replaces itself with the board.
  const close = () => {
    if (onExit) onExit({ replace: false });
    else
      backOr(
        router,
        () => void navigate({ to: '/groups/$groupId/tasks', params: { groupId }, replace: true }),
      );
  };

  // Live: someone else changed or deleted this task.
  useEffect(() => {
    const socket = getSocket();
    const onTask = ({ task, actor }: BoardTaskEvent) => {
      if (task.groupId !== groupId || task.id !== latest.current.base.id) return;
      if (actor.id === me?.id || task.updatedAt === latest.current.base.updatedAt) return;
      if (latest.current.dirty) setStale({ by: actor.name });
      else void doReload(true);
    };
    const onDeleted = (event: BoardTaskDeletedEvent) => {
      if (event.groupId !== groupId || event.taskId !== latest.current.base.id) return;
      // Our own delete: the socket frame can beat the HTTP answer, and we know already.
      if (deleting.current) return;
      if (!onExit) showBoardNotice(queryClient, groupId, 'taskDeleted');
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
    if (busy || uploading) return;
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
      } else if (error instanceof ApiError && error.code === 'invalid_url') {
        setErrors({ link: t('tasks.form.errors.invalidLink') });
      } else if (error instanceof ApiError && error.code === 'invalid_knowledge_item') {
        setErrors({ form: t('chat.editor.knowledgeUnavailable') });
      } else if (error instanceof ApiError && error.code === 'invalid_project') {
        // The project or event was deleted, or moved, meanwhile.
        setErrors({ form: t('tasks.form.errors.invalidProject') });
      } else if (error instanceof ApiError && error.code === 'invalid_assignee') {
        // Someone chosen left the group or stopped managing it: refresh who can be assigned.
        setErrors({ assigneeIds: t('tasks.form.errors.assigneeNotAllowed') });
        void queryClient.invalidateQueries({ queryKey: groupPeopleQuery(groupId).queryKey });
      } else {
        setErrors({ form: t('tasks.board.error') });
      }
    } finally {
      setBusy(false);
    }
  }

  /** Moves the task to the end of `bucketId` (the select) or to its top (the done circle). */
  async function onBucket(bucketId: string, place: 'end' | 'top' = 'end') {
    if (!board || bucketId === bucketOf?.id) return;
    setMoveFailed(false);
    setMoving(true);
    const after = place === 'end' ? tasksByBucket(board).get(bucketId)?.at(-1) : undefined;
    try {
      const moved = await moveTask(base.id, { bucketId, afterTaskId: after?.id ?? null });
      queryClient.setQueryData<BoardDto>(
        boardQuery(groupId).queryKey,
        (b) => b && upsertTask(b, moved),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        if (!onExit) showBoardNotice(queryClient, groupId, 'taskDeleted');
        backToBoard(true);
      } else setMoveFailed(true);
    } finally {
      setMoving(false);
    }
  }

  /** The done circle: to the top of Completed, or back to the top of To do. */
  function toggleDone() {
    const target = board && bucketOf && doneTarget(board.buckets, bucketOf.id);
    if (target) void onBucket(target.id, 'top');
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    deleting.current = true;
    try {
      await deleteTask(base.id);
      queryClient.setQueryData<BoardDto>(
        boardQuery(groupId).queryKey,
        (b) => b && removeTask(b, base.id),
      );
      queryClient.removeQueries({ queryKey: taskQuery(base.id).queryKey });
      backToBoard(true);
    } catch {
      deleting.current = false;
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
      <PanelHeader onClose={close}>
        <OpenInClaude source={{ kind: 'task', id: base.id }} compact />
        <BucketSelect
          buckets={board?.buckets}
          groupName={group?.name ?? ''}
          value={bucketOf?.id ?? ''}
          disabled={!board || !bucketOf || moving}
          onChange={(bucketId) => void onBucket(bucketId)}
        />
        {canDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('tasks.panel.more')}
              className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent max-[640px]:size-11"
            >
              <MoreIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-error-ink">
                {t('tasks.panel.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PanelHeader>

      <div className="shrink-0 space-y-2 px-4 pt-3 empty:hidden min-[641px]:px-6">
        {banner}
        {blocker.status === 'blocked' && (
          <PanelNotice text={t('tasks.panel.unsaved')}>
            <Button size="sm" variant="destructive" onClick={blocker.proceed}>
              {t('tasks.panel.discard')}
            </Button>
            <Button size="sm" variant="outline" onClick={blocker.reset}>
              {t('tasks.panel.keepEditing')}
            </Button>
          </PanelNotice>
        )}
        {confirmDelete && (
          <PanelNotice text={t('tasks.panel.deleteConfirm')}>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
              {t('tasks.panel.delete')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t('tasks.panel.cancel')}
            </Button>
          </PanelNotice>
        )}
        {stale && (
          <PanelNotice
            text={
              stale.by
                ? t('tasks.panel.changedBy', { name: stale.by })
                : t('tasks.panel.changedBySomeone')
            }
          >
            <Button size="sm" variant="outline" onClick={() => void doReload()}>
              {t('tasks.panel.reload')}
            </Button>
          </PanelNotice>
        )}
      </div>

      <div className="shrink-0 space-y-2 px-4 pt-4 pb-3 min-[641px]:px-6 min-[641px]:pt-5">
        <div className="flex items-start gap-3">
          {/* 18 px circle centred on the first 28 px line of the title. */}
          <DoneCircle
            done={bucketOf?.kind === 'done'}
            disabled={!bucketOf || moving}
            onToggle={toggleDone}
            describedBy="task-panel-title"
            className="mt-[5px]"
          />
          <h2
            id="task-panel-title"
            ref={heading}
            tabIndex={-1}
            className={cn(
              // A long title never pushes the tabs and the chat off a phone screen.
              'line-clamp-3 min-w-0 break-words text-medium leading-tight font-semibold outline-none',
              bucketOf?.kind === 'done' && 'text-muted-foreground line-through',
            )}
          >
            {base.title}
          </h2>
        </div>
        {moveFailed && (
          <p role="alert" className="text-button text-error-ink">
            {t('tasks.board.moveFailed')}
          </p>
        )}
      </div>

      <PanelTabs tab={tab} chatCount={chats?.[initial.id]?.count ?? 0} onChange={setTab} />

      {/* Details stays mounted while Chat shows: the draft and the unsaved-changes guard live on. */}
      <div
        role="tabpanel"
        id={panelTabIds('details').panel}
        aria-labelledby={panelTabIds('details').tab}
        hidden={tab !== 'details'}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 min-[641px]:p-6">
          {base.sourceTicket && <SourceTicketLine ticket={base.sourceTicket} />}
          {base.sourceMeeting && (
            <SourceMeetingLine groupId={groupId} meeting={base.sourceMeeting} />
          )}
          {base.sourceMessage && <SourceMessage groupId={groupId} message={base.sourceMessage} />}

          <TaskForm
            value={draft}
            onChange={setDraft}
            groupId={groupId}
            errors={errors}
            files={files}
            onFilesChange={setFiles}
            knowledge={{
              items: linked,
              onChange: setLinked,
              subject: { kind: 'task', id: base.id },
            }}
            knownPeople={base.assignees}
            projectRefs={{ project: base.project, event: base.event }}
            onUploadingChange={setUploading}
            timeSlot={
              seesTime(
                me,
                base.assignees.map((p) => p.id),
              ) && <TaskMyTime task={base} />
            }
            remindersSlot={
              <TaskReminders
                task={base}
                onTaskGone={() => {
                  showBoardNotice(queryClient, groupId, 'taskDeleted');
                  backToBoard(true);
                }}
              />
            }
          />

          {dirty && (
            <div className="flex gap-3">
              {uploading && (
                <p
                  id="task-upload-wait"
                  role="status"
                  className="self-center text-tiny text-muted-foreground"
                >
                  {t('forms.files.waiting')}
                </p>
              )}
              <Button
                disabled={busy || uploading}
                aria-describedby={uploading ? 'task-upload-wait' : undefined}
                onClick={() => void save()}
              >
                {t('tasks.panel.save')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(toDraft(base));
                  setFiles(base.files);
                  setLinked(base.linkedKnowledge);
                  setErrors({});
                }}
              >
                {t('tasks.panel.cancel')}
              </Button>
            </div>
          )}
        </div>

        <footer className="border-t-2 border-border px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] text-tiny text-muted-foreground min-[641px]:px-6">
          {t('tasks.panel.createdBy', {
            name: base.createdBy.name,
            date: formatCreated(base.createdAt, i18n.language),
          })}
        </footer>
      </div>

      {tab === 'chat' && (
        <div
          role="tabpanel"
          id={panelTabIds('chat').panel}
          aria-labelledby={panelTabIds('chat').tab}
          data-own-touch
          className="min-h-0 flex-1 p-2 pb-[max(8px,env(safe-area-inset-bottom))] min-[641px]:p-4 min-[641px]:pb-[max(16px,env(safe-area-inset-bottom))]"
        >
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <TaskChat groupId={groupId} taskId={base.id} />
          </Suspense>
        </div>
      )}
    </>
  );
}
