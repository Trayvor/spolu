import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  ErrorCodes,
  isMeetingAiBusy,
  KnowledgeEvents,
  MEETING_LIMITS,
  type KnowledgeItemDto,
  type KnowledgeMeetingTasksEvent,
  type MeetingActionItem,
  type MeetingDetail,
  type MeetingSummary,
  type MeetingTaskLink,
} from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PanelNotice } from '@/components/ui/panel-notice';
import { Toast } from '@/components/ui/toast';
import { useSession } from '@/features/auth/use-session';
import { MessageBody } from '@/features/chat/format/render';
import { DescriptionField } from '@/features/editor/description-field';
import { PlainTextField } from '@/features/editor/plain-text-field';
import { fileUrl } from '@/features/files/urls';
import { formatFileSize } from '@/features/files/format-size';
import { TasksIcon } from '@/features/task-split/use-message-task-tools';
import { bucketTitle } from '@/features/tasks/board-model';
import { useNamespaces, withNamespaces } from '@/i18n/namespaces';
import { ApiError } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { knowledgeItemQuery, updateKnowledge } from './api';
import { CalendarLeaf } from './calendar-leaf';
import { ArrowOutIcon } from './icons';
import { deleteRecording, processMeeting, uploadRecording } from './meeting-api';

// The review dialog and its task form load only when "Create tasks" is pressed.
const ReviewDialog = lazy(
  withNamespaces(
    ['forms', 'tasks', 'taskSplit'],
    () => import('@/features/task-split/review-dialog'),
  ),
);

const locale = (language: string) => (/^en\b/.test(language) ? 'en-GB' : language);

/** Whether the meeting is being worked on in the background (the dialog polls meanwhile). */
export function meetingInProgress(item: KnowledgeItemDto | undefined): boolean {
  const meeting = item?.meetingDetail;
  if (!meeting) return false;
  return meeting.recording.state === 'processing' || isMeetingAiBusy(meeting.ai.state);
}

const SECTION = 'flex flex-col gap-3 border-t-2 border-border pt-4';

function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <h3 id={id} className="text-body font-semibold">
      {children}
    </h3>
  );
}

/** The date leaf, the full date and time, and the meeting's links as pills. */
export function MeetingWhen({ meeting }: { meeting: MeetingDetail }) {
  const { t, i18n } = useTranslation();
  const when = new Intl.DateTimeFormat(locale(i18n.language), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(meeting.startsAt));
  const links = [
    { url: meeting.meetingUrl, label: t('knowledge.meeting.join'), primary: true },
    { url: meeting.recordingUrl, label: t('knowledge.meeting.openRecording'), primary: false },
    { url: meeting.transcriptUrl, label: t('knowledge.meeting.openTranscript'), primary: false },
  ].filter((link): link is { url: string; label: string; primary: boolean } => !!link.url);
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-3">
        <CalendarLeaf iso={meeting.startsAt} size={40} />
        <span className="text-body font-semibold first-letter:uppercase">{when}</span>
      </p>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map((link) => (
            <Button
              key={link.label}
              asChild
              variant={link.primary ? 'default' : 'outline'}
              size="sm"
            >
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="gap-1.5">
                {link.label}
                <ArrowOutIcon />
              </a>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function uploadProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === ErrorCodes.fileTooLarge) return 'knowledge.meeting.recording.tooLarge';
    if (error.code === ErrorCodes.invalidRecording) return 'knowledge.meeting.recording.notMedia';
    if (error.code === ErrorCodes.recordingBusy) return 'knowledge.meeting.recording.busy';
    if (error.code === ErrorCodes.rateLimited) return 'knowledge.meeting.recording.rateLimited';
  }
  return 'knowledge.meeting.recording.uploadFailed';
}

/**
 * The stored recording: a player when ready, the state while it is converted or after it
 * failed, and (for the item's editors) upload, replace and delete.
 */
export function RecordingSection({
  item,
  onChanged,
}: {
  item: KnowledgeItemDto;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const meeting = item.meetingDetail!;
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { state, file } = meeting.recording;

  async function upload(chosen: File) {
    setProblem(null);
    setProgress(0);
    try {
      await uploadRecording(item.id, chosen, setProgress);
      onChanged();
    } catch (error) {
      setProblem(t(uploadProblem(error)));
    } finally {
      setProgress(null);
    }
  }

  async function remove() {
    setConfirmDelete(false);
    try {
      await deleteRecording(item.id);
      onChanged();
    } catch {
      setProblem(t('knowledge.meeting.recording.deleteFailed'));
    }
  }

  const uploading = progress !== null;
  const canUpload = item.canEdit && !uploading && state !== 'processing';
  if (!item.canEdit && state !== 'ready' && state !== 'processing') return null;

  return (
    <section aria-labelledby={`${uid}-title`} className={SECTION}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle id={`${uid}-title`}>{t('knowledge.meeting.recording.title')}</SectionTitle>
        {canUpload && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
              {state === 'ready'
                ? t('knowledge.meeting.recording.replace')
                : t('knowledge.meeting.recording.upload')}
            </Button>
            {state === 'ready' && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                {t('knowledge.meeting.recording.delete')}
              </Button>
            )}
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="audio/*,video/*"
          className="hidden"
          data-testid="meeting-recording-input"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (chosen) void upload(chosen);
          }}
        />
      </div>
      {confirmDelete && (
        <PanelNotice text={t('knowledge.meeting.recording.deleteConfirm')}>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            {t('knowledge.detail.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => void remove()}>
            {t('knowledge.meeting.recording.delete')}
          </Button>
        </PanelNotice>
      )}
      {uploading ? (
        <div role="status" className="flex flex-col gap-1.5">
          <p className="text-button text-muted-foreground">
            {t('knowledge.meeting.recording.uploading', { percent: Math.round(progress * 100) })}
          </p>
          <span
            aria-hidden="true"
            className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
          >
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </span>
        </div>
      ) : state === 'processing' ? (
        <p role="status" className="text-button text-muted-foreground">
          {t('knowledge.meeting.recording.processing')}
        </p>
      ) : state === 'failed' ? (
        <p className="text-button text-error-ink">{t('knowledge.meeting.recording.failed')}</p>
      ) : state === 'ready' && file ? (
        <div className="flex flex-col gap-1.5">
          <audio controls preload="metadata" src={fileUrl(file.id)} className="w-full">
            <a href={fileUrl(file.id)}>{file.name}</a>
          </audio>
          <p className="text-micro text-muted-foreground">
            <a href={fileUrl(file.id)} className="font-semibold underline underline-offset-4">
              {file.name}
            </a>{' '}
            {formatFileSize(file.size, i18n.language)}
          </p>
        </div>
      ) : (
        <p className="text-button text-muted-foreground">{t('knowledge.meeting.recording.none')}</p>
      )}
      {problem && (
        <p role="alert" className="text-button text-error-ink">
          {problem}
        </p>
      )}
    </section>
  );
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MEETING_LIMITS.listItems);

/**
 * The summary's fields: the paragraph in the description editor (AI and voice, Phase 33 part
 * P5), the lists one per line, action item rows.
 */
function SummaryEditor({
  groupId,
  summary,
  onCancel,
  onSave,
}: {
  groupId: string;
  summary: MeetingSummary;
  onCancel: () => void;
  onSave: (next: MeetingSummary) => Promise<void>;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const [text, setText] = useState(summary.summary);
  const [decisions, setDecisions] = useState(summary.decisions.join('\n'));
  const [questions, setQuestions] = useState(summary.openQuestions.join('\n'));
  const [actions, setActions] = useState<MeetingActionItem[]>(summary.actionItems);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const setAction = (index: number, patch: Partial<MeetingActionItem>) =>
    setActions((list) => list.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await onSave({
        summary: text.trim().slice(0, MEETING_LIMITS.summary),
        decisions: lines(decisions),
        openQuestions: lines(questions),
        actionItems: actions
          .map((a) => ({
            text: a.text.trim(),
            assignee: a.assignee?.trim() ? a.assignee.trim() : null,
            deadline: a.deadline || null,
          }))
          .filter((a) => a.text !== ''),
        language: summary.language,
      });
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DescriptionField
        id={`${uid}-summary`}
        groupId={groupId}
        value={text}
        onChange={setText}
        label={t('knowledge.meeting.ai.summary')}
        editLabel={t('knowledge.meeting.ai.edit')}
      />
      <PlainTextField
        id={`${uid}-decisions`}
        target={{ kind: 'group', id: groupId }}
        label={t('knowledge.meeting.ai.decisions')}
        value={decisions}
        onChange={setDecisions}
        rows={3}
        lines
        describedBy={`${uid}-lines`}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-button font-semibold">
          {t('knowledge.meeting.ai.actionItems')}
        </legend>
        {actions.map((action, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-lg bg-muted p-3 min-[641px]:flex-row"
          >
            <Input
              aria-label={t('knowledge.meeting.ai.actionText', { n: index + 1 })}
              value={action.text}
              maxLength={MEETING_LIMITS.listItem}
              onChange={(event) => setAction(index, { text: event.target.value })}
              className="min-w-0 flex-[3]"
            />
            <Input
              aria-label={t('knowledge.meeting.ai.assignee')}
              placeholder={t('knowledge.meeting.ai.assignee')}
              value={action.assignee ?? ''}
              maxLength={MEETING_LIMITS.assignee}
              onChange={(event) => setAction(index, { assignee: event.target.value })}
              className="min-w-0 flex-[2]"
            />
            <Input
              type="date"
              aria-label={t('knowledge.meeting.ai.deadline')}
              value={action.deadline ?? ''}
              onChange={(event) => setAction(index, { deadline: event.target.value || null })}
              className="min-w-0 flex-[2] px-3"
            />
            <Button
              variant="ghost"
              size="sm"
              className="self-start min-[641px]:self-center"
              onClick={() => setActions((list) => list.filter((_, i) => i !== index))}
            >
              {t('knowledge.meeting.ai.remove')}
            </Button>
          </div>
        ))}
        {actions.length < MEETING_LIMITS.listItems && (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() =>
              setActions((list) => [...list, { text: '', assignee: null, deadline: null }])
            }
          >
            {t('knowledge.meeting.ai.addAction')}
          </Button>
        )}
      </fieldset>
      <PlainTextField
        id={`${uid}-questions`}
        target={{ kind: 'group', id: groupId }}
        label={t('knowledge.meeting.ai.openQuestions')}
        value={questions}
        onChange={setQuestions}
        rows={3}
        lines
        describedBy={`${uid}-lines`}
      />
      <p id={`${uid}-lines`} className="text-tiny text-muted-foreground">
        {t('knowledge.meeting.ai.oneLine')}
      </p>
      {error && (
        <p role="alert" className="text-button text-error-ink">
          {t('knowledge.detail.saveFailed')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          {t('knowledge.detail.cancel')}
        </Button>
        <Button aria-disabled={busy} onClick={() => void save()}>
          {t('knowledge.meeting.ai.save')}
        </Button>
      </div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-button font-semibold">{title}</h4>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-button">
        {items.map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    </div>
  );
}

function processProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === ErrorCodes.nothingToProcess) return 'knowledge.meeting.ai.nothing';
    if (error.code === ErrorCodes.meetingBusy) return 'knowledge.meeting.ai.busy';
    if (error.code === ErrorCodes.aiUnavailable) return 'knowledge.meeting.ai.unavailable';
    if (error.code === ErrorCodes.rateLimited) return 'knowledge.meeting.ai.rateLimited';
  }
  return 'knowledge.meeting.ai.startFailed';
}

/**
 * The tasks made from the meeting's action items, in place of the items once there are any: a
 * link per task to its panel on the board (struck through when completed), with its bucket and
 * assignees. `onCreateMore` (admins, while some action items have no task yet) opens the review
 * with the rest. Loads the task texts for the bucket names, so it renders under a `Suspense`.
 */
function MeetingTasks({
  groupId,
  tasks,
  onCreateMore,
}: {
  groupId: string;
  tasks: MeetingTaskLink[];
  onCreateMore?: () => void;
}) {
  useNamespaces(['tasks']);
  const { t } = useTranslation();
  const uid = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`${uid}-tasks`} className="text-button font-semibold">
          {t('knowledge.meeting.ai.tasksTitle')}
          <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
            {tasks.length}
          </span>
        </h4>
        {onCreateMore && (
          <Button variant="ghost" size="sm" onClick={onCreateMore}>
            {t('knowledge.meeting.ai.createMoreTasks')}
          </Button>
        )}
      </div>
      <ul aria-labelledby={`${uid}-tasks`} className="flex flex-col gap-1.5">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex flex-col gap-0.5 rounded-lg bg-muted px-3 py-2 min-[641px]:flex-row min-[641px]:items-baseline min-[641px]:gap-3"
          >
            <Link
              to="/groups/$groupId/tasks/$taskId"
              params={{ groupId, taskId: task.id }}
              className={cn(
                'min-w-0 flex-1 truncate text-button font-semibold underline underline-offset-4 hover:text-neutral',
                task.completed && 'text-muted-foreground line-through',
              )}
            >
              {task.title}
              {task.completed && (
                <span className="sr-only"> {t('knowledge.meeting.ai.taskCompleted')}</span>
              )}
            </Link>
            <span className="shrink-0 text-micro text-muted-foreground">
              {[
                bucketTitle(t, task.bucket, task.bucket.name ?? ''),
                ...task.assignees.map((p) => p.name),
              ].join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The AI summary: its state while a run is queued or running, "Process with AI" (admins, when
 * the server can run it), the summary itself (editable by the item's editors) and "Create tasks"
 * from its action items (admins). Once tasks were made from the meeting they show instead of the
 * action items, and change live (`knowledge:meeting_tasks` refetches the item).
 */
export function SummarySection({
  item,
  onChanged,
}: {
  item: KnowledgeItemDto;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const queryClient = useQueryClient();
  const role = useSession()?.role;
  const isAdmin = role === 'admin' || role === 'superadmin';
  const meeting = item.meetingDetail!;
  const { summary, ai } = meeting;
  const [editing, setEditing] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [created, setCreated] = useState<number | null>(null);
  const busy = isMeetingAiBusy(ai.state);
  const tasks = meeting.tasks;

  // A task made from this meeting changed somewhere (created, edited, moved, deleted): refetch.
  useEffect(() => {
    const socket = getSocket();
    const onTasks = (event: KnowledgeMeetingTasksEvent) => {
      if (event.id !== item.id) return;
      void queryClient.invalidateQueries({
        queryKey: knowledgeItemQuery(item.id).queryKey,
        exact: true,
      });
    };
    socket.on(KnowledgeEvents.meetingTasks, onTasks);
    return () => {
      socket.off(KnowledgeEvents.meetingTasks, onTasks);
    };
  }, [item.id, queryClient]);

  async function start() {
    setConfirmAgain(false);
    setProblem(null);
    try {
      await processMeeting(item.id);
      onChanged();
    } catch (error) {
      setProblem(t(processProblem(error)));
    }
  }

  async function saveSummary(next: MeetingSummary) {
    const saved = await updateKnowledge(item.id, {
      updatedAt: item.updatedAt,
      meeting: { summary: next },
    });
    queryClient.setQueryData(['knowledge', 'item', saved.id], saved);
    setEditing(false);
  }

  if (!summary && !isAdmin && !busy) return null;
  const deadline = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(locale(i18n.language), {
      day: 'numeric',
      month: 'short',
    });

  return (
    <section aria-labelledby={`${uid}-title`} className={SECTION}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle id={`${uid}-title`}>{t('knowledge.meeting.ai.title')}</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {summary && !editing && item.canEdit && !busy && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              {t('knowledge.meeting.ai.edit')}
            </Button>
          )}
          {meeting.canProcess && !busy && !editing && (
            <Button
              variant={summary ? 'secondary' : 'default'}
              size="sm"
              className="pl-3"
              onClick={() => (summary ? setConfirmAgain(true) : void start())}
            >
              <TasksIcon />
              {summary ? t('knowledge.meeting.ai.processAgain') : t('knowledge.meeting.ai.process')}
            </Button>
          )}
        </div>
      </div>
      {confirmAgain && (
        <PanelNotice text={t('knowledge.meeting.ai.againConfirm')}>
          <Button variant="ghost" onClick={() => setConfirmAgain(false)}>
            {t('knowledge.detail.cancel')}
          </Button>
          <Button onClick={() => void start()}>{t('knowledge.meeting.ai.processAgain')}</Button>
        </PanelNotice>
      )}
      {busy && (
        <p role="status" className="text-button text-muted-foreground">
          {t(`knowledge.meeting.ai.${ai.state}`)}
        </p>
      )}
      {ai.state === 'failed' && !busy && (
        <p className="text-button text-error-ink">
          {t(`knowledge.meeting.ai.failed_${ai.error ?? 'summary_failed'}`)}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-button text-error-ink">
          {problem}
        </p>
      )}
      {editing && summary ? (
        <SummaryEditor
          groupId={item.groupId}
          summary={summary}
          onCancel={() => setEditing(false)}
          onSave={saveSummary}
        />
      ) : summary ? (
        <div className="flex flex-col gap-4">
          {summary.summary && (
            <div className="text-body">
              <MessageBody body={summary.summary} nameOf={() => undefined} />
            </div>
          )}
          <List title={t('knowledge.meeting.ai.decisions')} items={summary.decisions} />
          {tasks.length > 0 ? (
            <Suspense fallback={null}>
              <MeetingTasks
                groupId={item.groupId}
                tasks={tasks}
                {...(isAdmin && meeting.actionItemsLeft > 0
                  ? { onCreateMore: () => setTasksOpen(true) }
                  : {})}
              />
            </Suspense>
          ) : (
            summary.actionItems.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-button font-semibold">
                    {t('knowledge.meeting.ai.actionItems')}
                  </h4>
                  {isAdmin && (
                    <Button variant="secondary" size="sm" onClick={() => setTasksOpen(true)}>
                      {t('knowledge.meeting.ai.createTasks')}
                    </Button>
                  )}
                </div>
                <ul className="flex flex-col gap-1.5">
                  {summary.actionItems.map((action, index) => (
                    <li
                      key={index}
                      className="flex flex-col gap-0.5 rounded-lg bg-muted px-3 py-2 min-[641px]:flex-row min-[641px]:items-baseline min-[641px]:gap-3"
                    >
                      <span className="min-w-0 flex-1 text-button">{action.text}</span>
                      {(action.assignee || action.deadline) && (
                        <span className="shrink-0 text-micro text-muted-foreground tabular-nums">
                          {[action.assignee, action.deadline ? deadline(action.deadline) : null]
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
          <List title={t('knowledge.meeting.ai.openQuestions')} items={summary.openQuestions} />
          <p className="text-micro text-muted-foreground">{t('knowledge.meeting.ai.aiMade')}</p>
        </div>
      ) : (
        !busy && (
          <p className="text-button text-muted-foreground">
            {meeting.canProcess
              ? t('knowledge.meeting.ai.noneAdmin')
              : t('knowledge.meeting.ai.none')}
          </p>
        )
      )}
      {tasksOpen && (
        <Suspense fallback={null}>
          <ReviewDialog
            groupId={item.groupId}
            source={{ kind: 'meeting', item }}
            onClose={() => setTasksOpen(false)}
            onCreated={(list) => {
              setTasksOpen(false);
              setCreated(list.length);
              void queryClient.invalidateQueries({
                queryKey: knowledgeItemQuery(item.id).queryKey,
                exact: true,
              });
            }}
          />
        </Suspense>
      )}
      {created !== null && (
        <Toast onClose={() => setCreated(null)}>
          <span>{t('knowledge.meeting.ai.tasksCreated', { count: created })}</span>
          <Link
            to="/groups/$groupId/tasks"
            params={{ groupId: item.groupId }}
            onClick={() => setCreated(null)}
            className="font-semibold underline underline-offset-4 hover:text-neutral"
          >
            {t('knowledge.meeting.ai.openBoard')}
          </Link>
        </Toast>
      )}
    </section>
  );
}

/** The transcript, folded: it can be long. */
export function TranscriptSection({ meeting }: { meeting: MeetingDetail }) {
  const { t } = useTranslation();
  if (meeting.transcript.trim() === '') return null;
  return (
    <details className={`${SECTION} group`}>
      <summary className="cursor-pointer text-body font-semibold">
        {t('knowledge.meeting.transcript')}
        {meeting.transcriptSource === 'ai' && (
          <span className="ml-2 text-micro font-normal text-muted-foreground">
            {t('knowledge.meeting.transcriptByAi')}
          </span>
        )}
      </summary>
      <div className="max-h-96 overflow-y-auto rounded-lg bg-muted px-4 py-3 text-button whitespace-pre-wrap break-words">
        {meeting.transcript}
      </div>
    </details>
  );
}
