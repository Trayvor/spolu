import { useId, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  PROJECT_LIMITS,
  type FileInfo,
  type LinkedKnowledge,
  type ProjectDto,
} from '@spolu/shared';
import { CloseIcon } from '@/components/icons';
import { FilesField } from '@/components/files-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { DescriptionField } from '@/features/editor/description-field';
import { ApiError } from '@/lib/api';
import { createProject, projectsKey, removeAlias, updateProject } from './api';

export const FIELD = 'flex flex-col gap-2.5';

/**
 * The inside of a project or event `SheetDialog`: the title with Close, a body that scrolls, and
 * a footer that clears the phone's home bar; a form (the finance dialogs' frame, with this
 * namespace's texts).
 */
export function DialogFrame({
  title,
  onClose,
  onSubmit,
  footer,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <header className="flex items-center gap-3 border-b-2 border-border px-4 py-3 min-[641px]:px-6">
        <div className="min-w-0 flex-1">{title}</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('projects.dialogs.close')}
          onClick={onClose}
        >
          <CloseIcon />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 min-[641px]:px-6 min-[641px]:py-5">
        {children}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t-2 border-border px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] min-[641px]:px-6">
        {footer}
      </footer>
    </form>
  );
}

/** The project form's field errors. */
export type ProjectFormErrors = Partial<Record<'name' | 'description' | 'form', string>>;

/** Checks the form before it is sent (`projects.dialogs.errors.*`). */
export function validateProject(
  value: { name: string; description: string },
  t: (key: string) => string,
): ProjectFormErrors {
  const errors: ProjectFormErrors = {};
  const name = value.name.trim();
  if (!name) errors.name = t('projects.dialogs.errors.nameRequired');
  else if (name.length > PROJECT_LIMITS.name)
    errors.name = t('projects.dialogs.errors.nameTooLong');
  if (value.description.length > PROJECT_LIMITS.description) {
    errors.description = t('projects.dialogs.errors.descriptionTooLong');
  }
  return errors;
}

/**
 * Create or edit a project (spec §7.5): name, description (the description editor with AI,
 * voice and attached knowledge, part P5), files, and for an existing project the aliases ("Also
 * matches", removable) and the eGrant id (read-only). `onClose` gets the saved project.
 */
export function ProjectDialog({
  groupId,
  project,
  onClose,
}: {
  groupId: string;
  /** The project to edit; a new one without it. */
  project?: ProjectDto;
  onClose: (saved?: ProjectDto) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const uid = useId();
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [files, setFiles] = useState<FileInfo[]>(project?.files ?? []);
  const [linked, setLinked] = useState<LinkedKnowledge>(project?.linkedKnowledge ?? []);
  const [aliases, setAliases] = useState(project?.aliases ?? []);
  const [updatedAt, setUpdatedAt] = useState(project?.updatedAt);
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [busy, setBusy] = useState(false);
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`projects.dialogs.${key}`, options);

  const refresh = () => client.invalidateQueries({ queryKey: projectsKey(groupId) });

  const save = async () => {
    const found = validateProject({ name, description }, t);
    setErrors(found);
    if (Object.keys(found).length > 0 || busy) return;
    setBusy(true);
    const fileIds = files.map((f) => f.id);
    const knowledgeIds = linked.map((k) => k.id);
    try {
      const saved = project
        ? await updateProject(project.id, {
            name: name.trim(),
            description,
            fileIds,
            knowledgeIds,
            updatedAt: updatedAt ?? project.updatedAt,
          })
        : await createProject(groupId, { name: name.trim(), description, fileIds, knowledgeIds });
      void refresh();
      onClose(saved);
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && error.code === 'project_name_taken') {
        const other = (error.body as { name?: string }).name ?? '';
        setErrors({ name: k('errors.nameTaken', { name: other }) });
      } else if (error instanceof ApiError && error.code === 'project_changed') {
        setErrors({ form: k('errors.changed') });
      } else if (error instanceof ApiError && error.code === 'invalid_knowledge_item') {
        setErrors({ form: t('chat.editor.knowledgeUnavailable') });
      } else if (error instanceof ApiError && error.code === 'invalid_attachment') {
        setErrors({ form: k('errors.files') });
      } else {
        setErrors({ form: k('errors.failed') });
      }
    }
  };

  const dropAlias = async (key: string) => {
    if (!project) return;
    try {
      const next = await removeAlias(project.id, key);
      setAliases(next.aliases);
      setUpdatedAt(next.updatedAt);
      void refresh();
    } catch {
      setErrors({ form: k('errors.failed') });
    }
  };

  return (
    <SheetDialog onEscape={() => onClose()} testId="project-dialog">
      <DialogFrame
        title={
          <SheetDialogTitle className="text-medium font-semibold">
            {project ? k('editProject') : k('newProject')}
          </SheetDialogTitle>
        }
        onClose={() => onClose()}
        onSubmit={() => void save()}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => onClose()}>
              {k('cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {project ? k('save') : k('create')}
            </Button>
          </>
        }
      >
        {errors.form && (
          <p role="alert" className="text-button text-error-ink">
            {errors.form}
          </p>
        )}
        <div className={FIELD}>
          <Label htmlFor={`${uid}-name`}>{k('name')}</Label>
          <Input
            id={`${uid}-name`}
            value={name}
            autoFocus={!project}
            maxLength={PROJECT_LIMITS.name + 20}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${uid}-name-error` : undefined}
          />
          {errors.name && (
            <p id={`${uid}-name-error`} className="text-tiny text-error-ink">
              {errors.name}
            </p>
          )}
        </div>
        <DescriptionField
          id={`${uid}-description`}
          mentions
          groupId={groupId}
          value={description}
          onChange={setDescription}
          label={k('description')}
          editLabel={k('editDescription')}
          error={errors.description}
          errorId={`${uid}-description-error`}
          knowledge={{
            items: linked,
            onChange: setLinked,
            subject: project ? { kind: 'project', id: project.id } : null,
          }}
        />
        <div className={FIELD}>
          <span id={`${uid}-files`} className="text-button font-semibold">
            {k('files')}
          </span>
          <FilesField
            groupId={groupId}
            fileIds={files.map((f) => f.id)}
            files={files}
            onAdd={(file) => setFiles((list) => [...list, file])}
            onRemove={(id) => setFiles((list) => list.filter((f) => f.id !== id))}
            labelId={`${uid}-files`}
            max={PROJECT_LIMITS.files}
            inputTestId="project-file-input"
          />
        </div>
        {project && aliases.length > 0 && (
          <div className={FIELD}>
            <span className="text-button font-semibold">{k('aliases')}</span>
            <p className="text-tiny text-muted-foreground">{k('aliasesHint')}</p>
            <ul role="list" className="flex flex-wrap gap-2">
              {aliases.map((alias) => (
                <li
                  key={alias}
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-secondary pr-1 pl-3 text-tiny font-semibold"
                >
                  {alias}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={k('removeAlias', { alias })}
                    onClick={() => void dropAlias(alias)}
                  >
                    <CloseIcon />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {project?.egrantProjectId && (
          <div className={FIELD}>
            <span className="text-button font-semibold">{k('egrantId')}</span>
            <p className="text-button">{project.egrantProjectId}</p>
          </div>
        )}
      </DialogFrame>
    </SheetDialog>
  );
}
