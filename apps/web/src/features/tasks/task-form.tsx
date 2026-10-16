import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TaskDraftSchema, type FileInfo, type TaskDraft, type TaskPerson } from '@spolu/shared';
import { i18n } from '@/i18n';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { FilesField } from '@/components/files-field';
import { FormattedTextField } from '@/components/formatted-text-field';
import { PeopleSelect } from '@/components/people-select';
import { useGroupPeople } from '@/features/groups/use-group-people';
import { UrgentSwitch } from './urgent-switch';

/** The most assignees and files a task has (the shared `TaskDraftSchema` checks the same). */
const MAX_ASSIGNEES = 10;
const MAX_TASK_FILES = 20;

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

/**
 * One field: label above, control, message. The 10 px gap is egrant.sk's and leaves the 5 px focus
 * ring (2 px outline, 3 px offset) clear of the label.
 */
const FIELD = 'flex flex-col gap-2.5';

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
  autoFocusTitle = false,
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
  /** Focus the title on mount (the create panel). */
  autoFocusTitle?: boolean;
}) {
  const { t } = useTranslation();
  const people = useGroupPeople(groupId).data;
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

      <div className={FIELD}>
        <Label htmlFor={id('title')}>{t('tasks.form.title')}</Label>
        <Input
          id={id('title')}
          autoFocus={autoFocusTitle}
          value={value.title}
          maxLength={200}
          aria-invalid={!!errors.title || undefined}
          aria-describedby={describedBy('title')}
          onChange={(event) => set({ title: event.target.value })}
        />
        <FieldError id={id('title-error')} message={errors.title} />
      </div>

      <div className={FIELD}>
        <FormattedTextField
          id={id('description')}
          groupId={groupId}
          value={value.description}
          onChange={(description) => set({ description })}
          label={t('tasks.form.description')}
          editLabel={t('tasks.form.editDescription')}
          error={errors.description}
          errorId={id('description-error')}
        />
        <FieldError id={id('description-error')} message={errors.description} />
      </div>

      <div className={FIELD}>
        <Label htmlFor={id('assignees')}>{t('tasks.form.assignees')}</Label>
        <PeopleSelect
          people={people}
          inputId={id('assignees')}
          max={MAX_ASSIGNEES}
          label={t('tasks.form.assignees')}
          value={value.assigneeIds}
          knownPeople={knownPeople}
          onChange={(assigneeIds) => set({ assigneeIds })}
          describedBy={describedBy('assigneeIds')}
          invalid={!!errors.assigneeIds}
        />
        <FieldError id={id('assigneeIds-error')} message={errors.assigneeIds} />
      </div>

      <div className={cn(FIELD, 'min-[641px]:items-start')}>
        <Label htmlFor={id('deadline')}>{t('tasks.form.deadline')}</Label>
        <Input
          id={id('deadline')}
          type="date"
          value={value.dueDate ?? ''}
          onChange={(event) => set({ dueDate: event.target.value || null })}
          className="min-[641px]:w-auto"
        />
      </div>

      <UrgentSwitch checked={value.urgent} onChange={(urgent) => set({ urgent })} />

      <div className={FIELD}>
        <Label id={id('files-label')}>{t('tasks.form.files')}</Label>
        <FilesField
          groupId={groupId}
          labelId={id('files-label')}
          max={MAX_TASK_FILES}
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
