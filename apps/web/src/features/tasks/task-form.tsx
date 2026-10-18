import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isHttpUrl,
  MAX_URL_LENGTH,
  TaskDraftSchema,
  type EventRefDto,
  type FileInfo,
  type ProjectRefDto,
  type TaskDraft,
  type TaskPerson,
} from '@spolu/shared';
import { i18n } from '@/i18n';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { FilesField } from '@/components/files-field';
import { PeopleSelect } from '@/components/people-select';
import { DescriptionField, type DescriptionKnowledge } from '@/features/editor/description-field';
import { useGroupPeople } from '@/features/groups/use-group-people';
import { EventSelect } from '@/features/projects/event-select';
import { ProjectSelect } from '@/features/projects/project-select';
import { LinkIcon } from './icons';
import { UrgentSwitch } from './urgent-switch';

/** The most assignees and files a task has (the shared `TaskDraftSchema` checks the same). */
const MAX_ASSIGNEES = 10;
const MAX_TASK_FILES = 20;

export type TaskFormErrors = Partial<
  Record<'title' | 'description' | 'assigneeIds' | 'link' | 'form', string>
>;

/** The empty draft a new card starts from. */
export const EMPTY_TASK_DRAFT: TaskDraft = {
  title: '',
  description: '',
  assigneeIds: [],
  dueDate: null,
  urgent: false,
  fileIds: [],
  link: null,
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
      errors.assigneeIds = i18n.t('forms.people.full', { max: MAX_ASSIGNEES });
    } else if (field === 'link') {
      errors.link = i18n.t('tasks.form.errors.invalidLink');
    } else if (
      field !== 'title' &&
      field !== 'description' &&
      field !== 'assigneeIds' &&
      field !== 'link'
    ) {
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

/**
 * The one-time "the link is empty" warning of the forms that create a task by hand (the create
 * panel). `holdSave(draft)` is called on Save: while the link is empty and the warning has not
 * been shown yet, it shows it, focuses the link field and answers true (do not save); any later
 * Save goes through. Typing a link hides the warning for good. Editing a task never uses it.
 */
export function useEmptyLinkWarning() {
  const [state, setState] = useState<'unseen' | 'shown' | 'done'>('unseen');
  const inputRef = useRef<HTMLInputElement>(null);
  return {
    inputRef,
    shown: state === 'shown',
    holdSave(draft: TaskDraft): boolean {
      if (state !== 'unseen' || (draft.link ?? '').trim() !== '') return false;
      setState('shown');
      inputRef.current?.focus();
      return true;
    },
    /** Pass every draft change: a typed link settles the warning. */
    onDraft(draft: TaskDraft) {
      if (state === 'shown' && draft.link) setState('done');
    },
  };
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
  autoFocusTitle = false,
  remindersSlot,
  timeSlot,
  linkWarning = false,
  linkInputRef,
  onUploadingChange,
  knowledge,
  projectRefs,
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
  /**
   * The task panel's reminders section (or, in create mode, its hint), between the urgent switch
   * and the files, between 2 px rules. Not part of the draft: the section saves on its own. The
   * AI review does not pass it.
   */
  remindersSlot?: ReactNode;
  /** The task panel's "My time" (Phase 32), under the assignees; saves on its own. */
  timeSlot?: ReactNode;
  /** Show the empty-link warning under the link field (see `useEmptyLinkWarning`). */
  linkWarning?: boolean;
  linkInputRef?: Ref<HTMLInputElement>;
  /** True while a file uploads; the parent keeps Save disabled until it is false. */
  onUploadingChange?: (uploading: boolean) => void;
  /**
   * The knowledge attached to the description (Phase 33 part P5): its cards, kept by the parent
   * like `files`; a change also sets `value.knowledgeIds`. Absent (the AI review): none.
   */
  knowledge?: DescriptionKnowledge;
  /**
   * The names of the draft's project and event as the caller knows them (the task's DTO, the
   * ticket of an AI review), so the selects show them before their lists load (Phase 33 P2).
   */
  projectRefs?: { project: ProjectRefDto | null; event: EventRefDto | null };
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
  const linkDescribedBy =
    [describedBy('link'), linkWarning ? id('link-warning') : undefined].filter(Boolean).join(' ') ||
    undefined;
  const openable = value.link !== null && isHttpUrl(value.link.trim());

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
        <DescriptionField
          id={id('description')}
          groupId={groupId}
          value={value.description}
          onChange={(description) => set({ description })}
          knowledge={
            knowledge && {
              ...knowledge,
              onChange: (next) => {
                knowledge.onChange(next);
                set({ knowledgeIds: next.map((k) => k.id) });
              },
            }
          }
          label={t('tasks.form.description')}
          editLabel={t('tasks.form.editDescription')}
          error={errors.description}
          errorId={id('description-error')}
        />
        <FieldError id={id('description-error')} message={errors.description} />
      </div>

      <div className={FIELD}>
        <Label htmlFor={id('link')}>{t('tasks.form.link')}</Label>
        <Input
          id={id('link')}
          ref={linkInputRef}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder={t('tasks.form.linkPlaceholder')}
          value={value.link ?? ''}
          maxLength={MAX_URL_LENGTH}
          aria-invalid={!!errors.link || undefined}
          aria-describedby={linkDescribedBy}
          onChange={(event) => set({ link: event.target.value === '' ? null : event.target.value })}
        />
        <FieldError id={id('link-error')} message={errors.link} />
        {linkWarning && (
          <p
            id={id('link-warning')}
            role="status"
            className="rounded-lg bg-secondary px-3 py-2 text-tiny text-foreground"
          >
            {t('tasks.form.linkEmptyWarning')}
          </p>
        )}
        {openable && (
          <a
            href={value.link!.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-1.5 self-start text-tiny font-semibold underline underline-offset-2 hover:text-neutral"
          >
            <LinkIcon />
            {t('tasks.form.openLink')}
          </a>
        )}
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

      {timeSlot}

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

      <div className={FIELD}>
        <Label htmlFor={id('project')}>{t('tasks.form.project')}</Label>
        <ProjectSelect
          id={id('project')}
          groupId={groupId}
          value={value.projectId ?? null}
          current={projectRefs?.project}
          // A new project starts without an event (spec §6).
          onChange={(projectId) => set({ projectId, eventId: null })}
          labels={{
            label: t('tasks.form.project'),
            none: t('tasks.form.noProject'),
            archived: (name) => t('tasks.form.archivedProject', { name }),
          }}
        />
      </div>

      {value.projectId && (
        <div className={FIELD}>
          <Label htmlFor={id('event')}>{t('tasks.form.event')}</Label>
          <EventSelect
            // A new project's events are another list.
            key={value.projectId}
            id={id('event')}
            groupId={groupId}
            projectId={value.projectId}
            value={value.eventId ?? null}
            current={projectRefs?.event}
            onChange={(eventId) => set({ eventId })}
            labels={{ label: t('tasks.form.event'), none: t('tasks.form.noEvent') }}
          />
        </div>
      )}

      <UrgentSwitch checked={value.urgent} onChange={(urgent) => set({ urgent })} />

      {remindersSlot && <div className="border-y-2 border-border py-5">{remindersSlot}</div>}

      <div className={FIELD}>
        <Label id={id('files-label')}>{t('tasks.form.files')}</Label>
        <FilesField
          groupId={groupId}
          labelId={id('files-label')}
          max={MAX_TASK_FILES}
          onPendingChange={onUploadingChange}
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
