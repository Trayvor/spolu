import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PROJECT_LIMITS, type FileInfo, type ProjectEventDto } from '@spolu/shared';
import { FilesField } from '@/components/files-field';
import { FormattedTextField } from '@/components/formatted-text-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelNotice } from '@/components/ui/panel-notice';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { ApiError } from '@/lib/api';
import { createEvent, deleteEvent, projectsKey, updateEvent } from './api';
import { DialogFrame, FIELD, validateProject, type ProjectFormErrors } from './project-dialog';

type EventErrors = ProjectFormErrors & { occursOn?: string };

/**
 * Create or edit an event of a project (spec §7.5): the project (fixed), name, date (past dates
 * allowed), description and files; an existing event can be deleted here too, after a
 * confirmation (its tasks and tickets keep the project).
 */
export function EventDialog({
  groupId,
  project,
  event,
  onClose,
}: {
  groupId: string;
  project: { id: string; name: string };
  /** The event to edit; a new one without it. */
  event?: ProjectEventDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const uid = useId();
  const [name, setName] = useState(event?.name ?? '');
  const [occursOn, setOccursOn] = useState(event?.occursOn ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [files, setFiles] = useState<FileInfo[]>(event?.files ?? []);
  const [errors, setErrors] = useState<EventErrors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const k = (key: string) => t(`projects.dialogs.${key}`);

  const done = () => {
    void client.invalidateQueries({ queryKey: projectsKey(groupId) });
    onClose();
  };
  const fail = (error: unknown) => {
    setBusy(false);
    if (error instanceof ApiError && error.code === 'project_changed') {
      setErrors({ form: k('errors.changed') });
    } else if (error instanceof ApiError && error.code === 'invalid_attachment') {
      setErrors({ form: k('errors.files') });
    } else {
      setErrors({ form: k('errors.failed') });
    }
  };

  const save = async () => {
    const found: EventErrors = validateProject({ name, description }, t);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occursOn)) found.occursOn = k('errors.dateRequired');
    setErrors(found);
    if (Object.keys(found).length > 0 || busy) return;
    setBusy(true);
    const body = { name: name.trim(), occursOn, description, fileIds: files.map((f) => f.id) };
    try {
      if (event) await updateEvent(event.id, { ...body, updatedAt: event.updatedAt });
      else await createEvent(project.id, body);
      done();
    } catch (error) {
      fail(error);
    }
  };

  const remove = async () => {
    if (!event || busy) return;
    setBusy(true);
    try {
      await deleteEvent(event.id);
      done();
    } catch (error) {
      fail(error);
    }
  };

  return (
    <SheetDialog onEscape={() => onClose()} testId="event-dialog">
      <DialogFrame
        title={
          <SheetDialogTitle className="text-medium font-semibold">
            {event ? k('editEvent') : k('newEvent')}
          </SheetDialogTitle>
        }
        onClose={onClose}
        onSubmit={() => void save()}
        footer={
          <>
            {event && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-error-ink"
                onClick={() => setConfirmDelete(true)}
              >
                {k('deleteEvent')}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              {k('cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {event ? k('save') : k('create')}
            </Button>
          </>
        }
      >
        {confirmDelete && (
          <PanelNotice text={k('deleteEventConfirm')}>
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
              {k('cancel')}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void remove()}>
              {k('deleteEvent')}
            </Button>
          </PanelNotice>
        )}
        {errors.form && (
          <p role="alert" className="text-button text-error-ink">
            {errors.form}
          </p>
        )}
        <p className="text-button">
          <span className="font-semibold">{k('project')}</span> {project.name}
        </p>
        <div className="grid gap-5 min-[641px]:grid-cols-[1fr_200px]">
          <div className={FIELD}>
            <Label htmlFor={`${uid}-name`}>{k('eventName')}</Label>
            <Input
              id={`${uid}-name`}
              value={name}
              autoFocus={!event}
              maxLength={PROJECT_LIMITS.name + 20}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${uid}-name-error` : undefined}
            />
            {errors.name && (
              <p id={`${uid}-name-error`} className="text-tiny text-error-ink">
                {errors.name}
              </p>
            )}
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${uid}-date`}>{k('date')}</Label>
            <Input
              id={`${uid}-date`}
              type="date"
              value={occursOn}
              onChange={(e) => setOccursOn(e.target.value)}
              aria-invalid={errors.occursOn ? true : undefined}
              aria-describedby={errors.occursOn ? `${uid}-date-error` : undefined}
            />
            {errors.occursOn && (
              <p id={`${uid}-date-error`} className="text-tiny text-error-ink">
                {errors.occursOn}
              </p>
            )}
          </div>
        </div>
        <FormattedTextField
          id={`${uid}-description`}
          groupId={groupId}
          value={description}
          onChange={setDescription}
          label={k('description')}
          editLabel={k('editDescription')}
          error={errors.description}
          errorId={`${uid}-description-error`}
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
            inputTestId="event-file-input"
          />
        </div>
      </DialogFrame>
    </SheetDialog>
  );
}
