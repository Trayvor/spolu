import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { TaskDtoSchema, type BoardDto, type FileInfo, type TaskDraft } from '@spolu/shared';
import { groupPeopleQuery, groupQuery } from '@/features/groups/api';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { boardQuery, createTask } from './api';
import { upsertTask } from './board-cache';
import { BucketSelect, PanelHeader, PanelShell } from './panel-parts';
import { EMPTY_TASK_DRAFT, TaskForm, validateTaskDraft, type TaskFormErrors } from './task-form';

/** Route component: `/groups/:groupId/tasks/new?bucket=<id>`. */
export function NewTaskPanelRoute() {
  const { groupId } = useParams({ strict: false });
  const { bucket } = useSearch({ strict: false });
  return groupId ? <NewTaskPanel key={bucket} groupId={groupId} bucketId={bucket} /> : null;
}

/**
 * The task panel in create mode: the same form as the detail, empty, with the bucket of the
 * column that opened it (changeable). Nothing is saved before "Create"; closing discards the
 * draft. Files uploaded meanwhile stay unattached and the daily cleanup removes them.
 */
export function NewTaskPanel({ groupId, bucketId }: { groupId: string; bucketId?: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: board } = useQuery(boardQuery(groupId));
  const { data: group } = useQuery(groupQuery(groupId));
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [errors, setErrors] = useState<TaskFormErrors>({});
  const [chosen, setChosen] = useState<string | undefined>(bucketId);
  const [busy, setBusy] = useState(false);

  // An unknown or missing bucket falls back to To do once the board is known.
  const target =
    board?.buckets.find((b) => b.id === chosen) ?? board?.buckets.find((b) => b.kind === 'todo');
  const close = () => void navigate({ to: '/groups/$groupId/tasks', params: { groupId } });

  async function create() {
    if (busy || !target) return;
    const found = validateTaskDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
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
      setErrors({
        form: t(invalidAssignee ? 'tasks.form.errors.assigneeNotAllowed' : 'tasks.board.error'),
      });
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

      <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 min-[641px]:p-6">
        <h2 className="text-medium leading-tight font-semibold">{t('tasks.panel.newTask')}</h2>
        <TaskForm
          value={draft}
          onChange={setDraft}
          groupId={groupId}
          errors={errors}
          files={files}
          onFilesChange={setFiles}
          autoFocusTitle
        />
        <div className="flex gap-3">
          <Button disabled={busy || !target} onClick={() => void create()}>
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
