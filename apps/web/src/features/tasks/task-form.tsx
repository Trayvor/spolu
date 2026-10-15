import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TaskDraftSchema, type FileInfo, type TaskDraft, type TaskPerson } from '@spolu/shared';
import { i18n } from '@/i18n';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AssigneeSelect } from './assignee-select';
import { TaskFilesField } from './task-files-field';
import { UrgentSwitch } from './urgent-switch';

export type TaskFormErrors = Partial<
  Record<'title' | 'description' | 'assigneeIds' | 'form', string>
>;

/** The empty draft a new card starts from. */
export const EMPTY_TASK_DRAFT: TaskDraft = {
  title: '',
  description: '',
  assigneeIds: [],
  dueDate: null,
  urgent: false,
  fileIds: [],
};

/** Checks a draft with the shared schema and returns translated messages per field. */
export function validateTaskDraft(value: TaskDraft): TaskFormErrors {
  const result = TaskDraftSchema.safeParse(value);
  if (result.success) return {};
  const errors: TaskFormErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    const tooBig = issue.code === 'too_big';
    if (field === 'title' && !errors.title) {
      errors.title = i18n.t(
        tooBig ? 'tasks.form.errors.titleTooLong' : 'tasks.form.errors.titleRequired',
      );
    } else if (field === 'description' && !errors.description) {
      errors.description = i18n.t('tasks.form.errors.descriptionTooLong');
    } else if (field === 'assigneeIds' && !errors.assigneeIds) {
      errors.assigneeIds = i18n.t('tasks.form.errors.tooManyAssignees');
    } else if (field !== 'title' && field !== 'description' && field !== 'assigneeIds') {
      // Fields without an input of their own (files, deadline) report through the form error.
      errors.form ??= i18n.t(
        field === 'fileIds'
          ? 'tasks.form.errors.tooManyFiles'
          : field === 'dueDate'
            ? 'tasks.form.errors.invalidDate'
            : 'tasks.form.errors.invalid',
      );
    }
  }
  return errors;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-tiny text-error-ink">
      {message}
    </p>
  );
}

/**
 * The fields of a task, fully controlled: the parent owns `value`, the attached files' details
 * (`files`, kept in step through `onFilesChange`) and the errors, and does the saving. Used by the
 * task panel and, later, by the AI review screen once per proposed card.
 */
export function TaskForm({
  value,
  onChange,
  groupId,
  errors = {},
  files,
  onFilesChange,
  knownPeople,
}: {
  value: TaskDraft;
  onChange: (next: TaskDraft) => void;
  groupId: string;
  errors?: TaskFormErrors;
  /** Details of the files in `value.fileIds`; new uploads are added through `onFilesChange`. */
  files: FileInfo[];
  onFilesChange: (next: FileInfo[]) => void;
  /** Assignees who may no longer be group people; shown as "Name (removed)". */
  knownPeople?: TaskPerson[];
}) {
  const { t } = useTranslation();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  // Uploads finish after the render that started them; they must add to the latest draft.
  const latest = useRef({ value, onChange, files, onFilesChange });
  useEffect(() => {
    latest.current = { value, onChange, files, onFilesChange };
  });

  const set = (patch: Partial<TaskDraft>) => onChange({ ...value, ...patch });
  const describedBy = (field: keyof TaskFormErrors) =>
    errors[field] ? id(`${field}-error`) : undefined;

  return (
    <div className="space-y-5">
      {errors.form && (
        <p role="alert" className="text-button text-error-ink">
          {errors.form}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={id('title')}>{t('tasks.form.title')}</Label>
        <Input
          id={id('title')}
          value={value.title}
          maxLength={200}
          aria-invalid={!!errors.title || undefined}
          aria-describedby={describedBy('title')}
          onChange={(event) => set({ title: event.target.value })}
        />
        <FieldError id={id('title-error')} message={errors.title} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={id('description')}>{t('tasks.form.description')}</Label>
        <textarea
          id={id('description')}
          rows={4}
          value={value.description}
          aria-invalid={!!errors.description || undefined}
          aria-describedby={describedBy('description')}
          onChange={(event) => set({ description: event.target.value })}
          className="w-full rounded-md border-2 border-input bg-card px-[18px] py-[13px] text-button font-medium text-foreground placeholder:text-muted-foreground focus:border-foreground aria-invalid:border-destructive"
        />
        <FieldError id={id('description-error')} message={errors.description} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={id('assignees')}>{t('tasks.form.assignees')}</Label>
        <AssigneeSelect
          groupId={groupId}
          inputId={id('assignees')}
          value={value.assigneeIds}
          knownPeople={knownPeople}
          onChange={(assigneeIds) => set({ assigneeIds })}
          describedBy={describedBy('assigneeIds')}
          invalid={!!errors.assigneeIds}
        />
        <FieldError id={id('assigneeIds-error')} message={errors.assigneeIds} />
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={id('deadline')}>{t('tasks.form.deadline')}</Label>
          <Input
            id={id('deadline')}
            type="date"
            value={value.dueDate ?? ''}
            onChange={(event) => set({ dueDate: event.target.value || null })}
            className="w-auto"
          />
        </div>
        <div className="flex h-[52px] items-center">
          <UrgentSwitch checked={value.urgent} onChange={(urgent) => set({ urgent })} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label id={id('files-label')}>{t('tasks.form.files')}</Label>
        <TaskFilesField
          groupId={groupId}
          labelId={id('files-label')}
          fileIds={value.fileIds}
          files={files}
          onAdd={(file) => {
            // The ref is updated here, not only after render, so two uploads finishing together both land.
            const cur = latest.current;
            const nextFiles = [...cur.files.filter((f) => f.id !== file.id), file];
            const nextValue = { ...cur.value, fileIds: [...cur.value.fileIds, file.id] };
            latest.current = { ...cur, value: nextValue, files: nextFiles };
            cur.onFilesChange(nextFiles);
            cur.onChange(nextValue);
          }}
          onRemove={(fileId) => {
            const cur = latest.current;
            const nextFiles = cur.files.filter((f) => f.id !== fileId);
            const nextValue = {
              ...cur.value,
              fileIds: cur.value.fileIds.filter((f) => f !== fileId),
            };
            latest.current = { ...cur, value: nextValue, files: nextFiles };
            cur.onFilesChange(nextFiles);
            cur.onChange(nextValue);
          }}
        />
      </div>
    </div>
  );
}
