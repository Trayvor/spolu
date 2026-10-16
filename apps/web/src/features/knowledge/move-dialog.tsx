import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PanelHeader } from '@/components/ui/panel-header';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { groupFoldersQuery } from './api';
import { descendantIds, treeRows } from './folder-tree';
import { FolderIcon, LockIcon } from './icons';

/**
 * "Move to…": the group's folders as an indented tree under "Top level". The current place, and
 * for a folder the folder itself and everything below it, cannot be chosen. `onMove` saves; a
 * refusal shows its message here (`clientItemMessage` for 400 `invalid_visibility`).
 */
export function MoveDialog({
  groupId,
  name,
  currentFolderId,
  movingFolderId,
  clientItemMessage,
  onMove,
  onClose,
}: {
  groupId: string;
  /** The moved item's title or folder's name, for the heading. */
  name: string;
  currentFolderId: string | null;
  movingFolderId?: string;
  clientItemMessage: string;
  onMove: (folderId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const folders = useQuery(groupFoldersQuery(groupId));
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = folders.data ?? [];
  const blocked = movingFolderId
    ? new Set([movingFolderId, ...descendantIds(all, movingFolderId)])
    : new Set<string>();
  const rows = treeRows(all, i18n.language);

  async function move() {
    if (busy || choice === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await onMove(choice);
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : undefined;
      setError(
        code === 'invalid_visibility' ? clientItemMessage : t('knowledge.folders.moveFailed'),
      );
      setBusy(false);
    }
  }

  const option = (
    id: string | null,
    label: string,
    depth: number,
    adminsOnly: boolean,
    disabled: boolean,
  ) => {
    const selected = choice === id;
    const here = id === currentFolderId;
    return (
      <li key={id ?? 'top'} role="none">
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          disabled={disabled || here}
          onClick={() => setChoice(id)}
          style={{ paddingLeft: `${12 + depth * 20}px` }}
          className={cn(
            'flex min-h-11 w-full items-center gap-3 rounded-lg py-2 pr-3 text-left text-button',
            selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
          )}
        >
          <span className={selected ? '' : 'text-muted-foreground'}>
            <FolderIcon />
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">{label}</span>
          {adminsOnly && <LockIcon />}
          {here && <span className="shrink-0 text-tiny">{t('knowledge.folders.current')}</span>}
        </button>
      </li>
    );
  };

  return (
    <SheetDialog
      onEscape={(event) => {
        event.preventDefault();
        onClose();
      }}
      testId="move-dialog"
    >
      <PanelHeader onClose={onClose} compactBelow={641} backLabel={t('knowledge.detail.back')}>
        {null}
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 min-[641px]:px-6 min-[641px]:py-5">
        <SheetDialogTitle className="break-words text-medium font-semibold">
          {t('knowledge.folders.moveTitle', { name })}
        </SheetDialogTitle>
        {folders.isPending ? (
          <p role="status" className="text-button text-muted-foreground">
            {t('knowledge.folders.loading')}
          </p>
        ) : (
          <ul
            role="radiogroup"
            aria-label={t('knowledge.folders.moveTo')}
            className="flex flex-col gap-0.5"
          >
            {option(null, t('knowledge.folders.topLevel'), 0, false, false)}
            {rows.map(({ folder, depth }) =>
              option(
                folder.id,
                folder.name,
                depth + 1,
                folder.visibility === 'admins',
                blocked.has(folder.id),
              ),
            )}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-button text-error-ink">
            {error}
          </p>
        )}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t-2 border-border px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:pb-4">
        <Button variant="outline" size="lg" className="px-5" onClick={onClose}>
          {t('knowledge.folders.cancel')}
        </Button>
        <Button
          size="lg"
          aria-disabled={busy || choice === undefined}
          className="px-5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => void move()}
        >
          {t('knowledge.folders.moveHere')}
        </Button>
      </footer>
    </SheetDialog>
  );
}
