import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorCodes, type FileInfo } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { ImagePreview } from '@/features/files/image-preview';
import { uploadFile } from '@/features/files/upload';
import { CloseIcon, PaperclipIcon } from './icons';

export const MAX_TASK_FILES = 20;

type Pending = { key: number; name: string; progress: number };

/**
 * Attached files (chips or image previews with Remove) and an upload button. The file list is
 * owned by the caller: `fileIds` says which are attached, `files` has their details, and every
 * change goes out through `onAdd` / `onRemove`, so the list survives the form remounting.
 */
export function TaskFilesField({
  groupId,
  fileIds,
  files,
  onAdd,
  onRemove,
  inputId,
}: {
  groupId: string;
  fileIds: string[];
  files: FileInfo[];
  onAdd: (file: FileInfo) => void;
  onRemove: (id: string) => void;
  inputId: string;
}) {
  const { t } = useTranslation();
  const picker = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const attached = fileIds
    .map((id) => files.find((f) => f.id === id))
    .filter((f): f is FileInfo => !!f);
  const full = fileIds.length + pending.length >= MAX_TASK_FILES;

  const upload = async (file: File) => {
    const key = ++counter.current;
    setPending((list) => [...list, { key, name: file.name, progress: 0 }]);
    try {
      const info = await uploadFile(groupId, file, (progress) =>
        setPending((list) => list.map((p) => (p.key === key ? { ...p, progress } : p))),
      );
      onAdd(info);
    } catch (error) {
      const tooLarge =
        error instanceof ApiError &&
        (error.body as { error?: string } | undefined)?.error === ErrorCodes.fileTooLarge;
      const message = t(tooLarge ? 'tasks.form.fileTooLarge' : 'tasks.form.uploadFailed', {
        name: file.name,
      });
      setErrors((list) => [...list, message]);
    } finally {
      setPending((list) => list.filter((p) => p.key !== key));
    }
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    setErrors([]);
    const room = MAX_TASK_FILES - fileIds.length - pending.length;
    for (const file of picked.slice(0, Math.max(room, 0))) void upload(file);
  };

  return (
    <div className="space-y-3">
      {attached.length > 0 && (
        <ul className="space-y-2">
          {attached.map((file) => (
            <li key={file.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ImagePreview file={file} maxWidth={240} />
              </div>
              <button
                type="button"
                aria-label={t('tasks.form.removeFile', { name: file.name })}
                onClick={() => onRemove(file.id)}
                className="rounded-full p-2 hover:bg-secondary"
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      {pending.map((p) => (
        <div key={p.key} className="space-y-1" role="status">
          <p className="truncate text-tiny text-muted-foreground">
            {t('tasks.form.uploading', { name: p.name })}
          </p>
          <progress
            value={p.progress}
            max={1}
            aria-label={t('tasks.form.uploading', { name: p.name })}
            className="h-1 w-full"
          />
        </div>
      ))}
      {errors.map((message, i) => (
        <p key={i} role="alert" className="text-tiny text-error-ink">
          {message}
        </p>
      ))}
      <input
        ref={picker}
        id={inputId}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        data-testid="task-file-input"
        onChange={onPick}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={full}
        onClick={() => picker.current?.click()}
      >
        <PaperclipIcon />
        {t('tasks.form.attach')}
      </Button>
    </div>
  );
}
