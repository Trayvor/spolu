import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorCodes, type FileInfo } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { ImagePreview } from '@/features/files/image-preview';
import { uploadFile, uploadFileTo } from '@/features/files/upload';
import { CloseIcon, PaperclipIcon } from '@/components/icons';

type Pending = { key: number; name: string; progress: number };

/**
 * Attached files (chips or image previews with Remove) and an upload button, for at most `max`
 * files. The file list is owned by the caller: `fileIds` says which are attached, `files` has
 * their details, and every change goes out through `onAdd` / `onRemove`, so the list survives
 * the form remounting. With `max` 1 the picker takes one file and the button hides once a file
 * is attached; with more it stays, disabled, when the list is full. Needs the `forms` namespace.
 */
export function FilesField({
  groupId,
  fileIds,
  files,
  onAdd,
  onRemove,
  labelId,
  max,
  inputTestId = 'task-file-input',
  onPendingChange,
  uploadPath,
}: {
  groupId: string;
  fileIds: string[];
  files: FileInfo[];
  onAdd: (file: FileInfo) => void;
  onRemove: (id: string) => void;
  /** Id of the visible label that names this group of files and the Attach button. */
  labelId: string;
  /** The most files the list may hold (20 on a task). */
  max: number;
  /** `data-testid` of the hidden file picker. */
  inputTestId?: string;
  /** Called with true while any upload runs, false when none does: the form waits to save. */
  onPendingChange?: (pending: boolean) => void;
  /** Another upload route under `/api` than the group's files (finance: finance-only files). */
  uploadPath?: string;
}) {
  const { t } = useTranslation();
  const picker = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const uploading = pending.length > 0;
  // `onPendingChange` should be stable (a state setter); the cleanup clears it on unmount.
  useEffect(() => {
    onPendingChange?.(uploading);
    return () => onPendingChange?.(false);
  }, [uploading, onPendingChange]);

  const full = fileIds.length + pending.length >= max;

  const upload = async (file: File) => {
    const key = ++counter.current;
    setPending((list) => [...list, { key, name: file.name, progress: 0 }]);
    try {
      const onProgress = (progress: number) =>
        setPending((list) => list.map((p) => (p.key === key ? { ...p, progress } : p)));
      const info = uploadPath
        ? await uploadFileTo(uploadPath, file, onProgress)
        : await uploadFile(groupId, file, onProgress);
      onAdd(info);
    } catch (error) {
      const tooLarge =
        error instanceof ApiError &&
        (error.body as { error?: string } | undefined)?.error === ErrorCodes.fileTooLarge;
      const message = t(tooLarge ? 'forms.files.tooLarge' : 'forms.files.uploadFailed', {
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
    const room = max - fileIds.length - pending.length;
    for (const file of picked.slice(0, Math.max(room, 0))) void upload(file);
  };

  return (
    <div role="group" aria-labelledby={labelId} className="space-y-3">
      {fileIds.length > 0 && (
        <ul role="list" className="space-y-2">
          {fileIds.map((id) => {
            const file = files.find((f) => f.id === id);
            const name = file?.name ?? t('forms.files.unknown');
            return (
              <li key={id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {file ? (
                    <ImagePreview file={file} maxWidth={240} />
                  ) : (
                    <span className="inline-block max-w-full truncate rounded-lg bg-secondary px-3 py-2 text-button font-semibold">
                      {name}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={t('forms.files.remove', { name })}
                  onClick={() => onRemove(id)}
                  className="rounded-full p-2 hover:bg-secondary max-[640px]:p-3.5"
                >
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {pending.map((p) => (
        <div key={p.key} className="space-y-1" role="status">
          <p className="truncate text-tiny text-muted-foreground">
            {t('forms.files.uploading', { name: p.name })}
          </p>
          <progress
            value={p.progress}
            max={1}
            aria-label={t('forms.files.uploading', { name: p.name })}
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
        type="file"
        multiple={max > 1}
        hidden
        tabIndex={-1}
        aria-hidden="true"
        data-testid={inputTestId}
        onChange={onPick}
      />
      {!(full && max === 1) && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={full}
          onClick={() => picker.current?.click()}
        >
          <PaperclipIcon />
          {t('forms.files.attach')}
        </Button>
      )}
    </div>
  );
}
