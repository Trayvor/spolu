import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { KnowledgeFolderDto, Visibility } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelHeader } from '@/components/ui/panel-header';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { ApiError } from '@/lib/api';
import { createFolder, groupFoldersQuery, updateFolder } from './api';
import { VisibilityControl } from './knowledge-form';

const NAME_MAX = 100;

/** The message of a failed folder save. */
export function folderError(error: unknown, t: (key: string) => string, fallback: string): string {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === 'invalid_visibility') return t('knowledge.folders.clientItemInside');
  if (code === 'folder_limit') return t('knowledge.folders.limit');
  return t(fallback);
}

/**
 * Create a folder in `parent` (null: the top level), or edit `folder` (name, and for admins who
 * may see both, "Visible to"). Inside an admins-only folder the choice is locked to "Only eGrant".
 */
export function FolderDialog({
  groupId,
  folder,
  parent,
  canChooseVisibility,
  onDone,
  onClose,
}: {
  groupId: string;
  folder?: KnowledgeFolderDto;
  parent: KnowledgeFolderDto | null;
  canChooseVisibility: boolean;
  onDone: (folder: KnowledgeFolderDto) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const inAdmins = parent?.visibility === 'admins';
  const [name, setName] = useState(folder?.name ?? '');
  const [visibility, setVisibility] = useState<Visibility>(folder?.visibility ?? 'public');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) return setError(t('knowledge.folders.nameRequired'));
    if (trimmed.length > NAME_MAX) return setError(t('knowledge.folders.nameTooLong'));
    if (folder && trimmed === folder.name && visibility === folder.visibility) return onClose();
    setBusy(true);
    setError(null);
    try {
      const saved = folder
        ? await updateFolder(folder.id, {
            ...(trimmed !== folder.name ? { name: trimmed } : {}),
            ...(visibility !== folder.visibility ? { visibility } : {}),
          })
        : await createFolder(groupId, {
            name: trimmed,
            parentId: parent?.id ?? null,
            visibility: inAdmins ? 'admins' : visibility,
          });
      void client.invalidateQueries({ queryKey: groupFoldersQuery(groupId).queryKey });
      onDone(saved);
    } catch (caught) {
      setError(folderError(caught, t, 'knowledge.folders.saveFailed'));
      setBusy(false);
    }
  }

  return (
    <SheetDialog
      onEscape={(event) => {
        event.preventDefault();
        onClose();
      }}
      testId="folder-dialog"
    >
      <PanelHeader onClose={onClose} compactBelow={641} backLabel={t('knowledge.detail.back')}>
        {null}
      </PanelHeader>
      <form
        onSubmit={(event) => void submit(event)}
        className="flex min-h-0 flex-1 flex-col"
        noValidate
      >
        <div className="flex flex-col gap-5 overflow-y-auto px-4 py-4 min-[641px]:px-6 min-[641px]:py-5">
          <SheetDialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="text-medium font-semibold outline-none"
          >
            {folder ? t('knowledge.folders.edit') : t('knowledge.folders.new')}
          </SheetDialogTitle>
          <div className="flex flex-col gap-2">
            <Label htmlFor="folder-name" className="text-button font-semibold">
              {t('knowledge.folders.name')}
            </Label>
            <Input
              id="folder-name"
              value={name}
              autoFocus
              maxLength={NAME_MAX + 20}
              aria-invalid={error !== null}
              aria-describedby={error ? 'folder-error' : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {canChooseVisibility && (
            <VisibilityControl
              value={inAdmins ? 'admins' : visibility}
              onChange={setVisibility}
              disabled={inAdmins}
              hint={inAdmins ? t('knowledge.folders.inAdmins') : undefined}
            />
          )}
          {error && (
            <p id="folder-error" role="alert" className="text-button text-error-ink">
              {error}
            </p>
          )}
        </div>
        <footer className="mt-auto flex items-center justify-end gap-2 border-t-2 border-border px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:pb-4">
          <Button type="button" variant="outline" size="lg" className="px-5" onClick={onClose}>
            {t('knowledge.folders.cancel')}
          </Button>
          <Button
            type="submit"
            size="lg"
            aria-disabled={busy}
            className="px-5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            {folder ? t('knowledge.folders.save') : t('knowledge.folders.create')}
          </Button>
        </footer>
      </form>
    </SheetDialog>
  );
}
