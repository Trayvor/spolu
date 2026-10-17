import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { TaskDtoSchema, type BoardDto, type FileInfo, type TaskDraft } from '@spolu/shared';
import { groupPeopleQuery, groupQuery } from '@/features/groups/api';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { backOr } from '@/lib/back';
import { PanelHeader } from '@/components/ui/panel-header';
import { boardQuery, createTask } from './api';
import { upsertTask } from './board-cache';
import { BucketSelect, PanelShell } from './panel-parts';
import {
  EMPTY_TASK_DRAFT,
  TaskForm,
  useEmptyLinkWarning,
  validateTaskDraft,
  type TaskFormErrors,
} from './task-form';

/** Route component: `/groups/:groupId/tasks/new?bucket=<id>`. */
export function NewTaskPanelRoute() {
  const { groupId } = useParams({ strict: false });
  const { bucket } = useSearch({ strict: false });
  return groupId ? <NewTaskPanel key={bucket} groupId={groupId} bucketId={bucket} /> : null;
}

/**
 * The task panel in create mode: the same form as the detail, empty, with the bucket of the
 * column that opened it (changeable). Nothing is saved before "Create"; closing discards the
 * draft. Files uploaded meanwhile stay unattached and the daily cleanup removes them. The first
 * "Create" with an empty link only shows the empty-link warning (`useEmptyLinkWarning`).
 */
export function NewTaskPanel({ groupId, bucketId }: { groupId: string; bucketId?: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const { data: board } = useQuery(boardQuery(groupId));
  const { data: group } = useQuery(groupQuery(groupId));
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [errors, setErrors] = useState<TaskFormErrors>({});
  const [chosen, setChosen] = useState<string | undefined>(bucketId);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const linkWarning = useEmptyLinkWarning();

  // An unknown or missing bucket falls back to To do once the board is known.
  const target =
    board?.buckets.find((b) => b.id === chosen) ?? board?.buckets.find((b) => b.kind === 'todo');
  // Cancel and Create both go back to where "+ Add task" was pressed, so Back never reopens
  // the form; from a link from outside, the form replaces itself with the board.
  const close = () =>
    backOr(
      router,
      () => void navigate({ to: '/groups/$groupId/tasks', params: { groupId }, replace: true }),
    );

  async function create() {
    if (busy || uploading || !target) return;
    const found = validateTaskDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (linkWarning.holdSave(draft)) return;
    setBusy(true);
    try {
      const created = await createTask(groupId, { ...draft, bucketId: target.id });
      const card = TaskDtoSchema.parse(created); // drop the detail-only fields
      queryClient.setQueryData<BoardDto>(
        boardQuery(groupId).queryKey,
        (b) => b && upsertTask(b, card),
      );
      close();
    } catch (error) {
      const invalidAssignee = error instanceof ApiError && error.code === 'invalid_assignee';
      if (error instanceof ApiError && error.code === 'invalid_url') {
        setErrors({ link: t('tasks.form.errors.invalidLink') });
      } else {
        setErrors({
          form: t(invalidAssignee ? 'tasks.form.errors.assigneeNotAllowed' : 'tasks.board.error'),
        });
      }
      // Someone chosen left the group or stopped managing it: refresh who can be assigned.
      if (invalidAssignee)
        void queryClient.invalidateQueries({ queryKey: groupPeopleQuery(groupId).queryKey });
      setBusy(false);
    }
  }

  return (
    <PanelShell groupId={groupId}>
      <PanelHeader onClose={close}>
        <BucketSelect
          buckets={board?.buckets}
          groupName={group?.name ?? ''}
          value={target?.id ?? ''}
          disabled={!board}
          onChange={setChosen}
        />
      </PanelHeader>

      <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:p-6">
        <h2 className="text-medium leading-tight font-semibold">{t('tasks.panel.newTask')}</h2>
        <TaskForm
          value={draft}
          onChange={(next) => {
            setDraft(next);
            linkWarning.onDraft(next);
          }}
          groupId={groupId}
          errors={errors}
          files={files}
          onFilesChange={setFiles}
          linkWarning={linkWarning.shown}
          linkInputRef={linkWarning.inputRef}
          autoFocusTitle
          onUploadingChange={setUploading}
          remindersSlot={
            <p className="text-micro text-muted-foreground">{t('reminders.task.createHint')}</p>
          }
        />
        {uploading && (
          <p id="task-create-upload-wait" role="status" className="text-tiny text-muted-foreground">
            {t('forms.files.waiting')}
          </p>
        )}
        <div className="flex gap-3">
          <Button
            disabled={busy || uploading || !target}
            aria-describedby={uploading ? 'task-create-upload-wait' : undefined}
            onClick={() => void create()}
          >
            {t('tasks.panel.create')}
          </Button>
          <Button variant="outline" onClick={close}>
            {t('tasks.panel.cancel')}
          </Button>
        </div>
      </div>
    </PanelShell>
  );
}
