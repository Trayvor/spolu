import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { FinanceFolder } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { PanelHeader } from '@/components/ui/panel-header';
import { PanelNotice } from '@/components/ui/panel-notice';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { FolderDialog } from '@/features/knowledge/folder-dialog';
import { MoveDialog } from '@/features/knowledge/move-dialog';
import type { FolderAction } from '../documents-card';
import {
  createFinanceFolder,
  deleteFinanceFolder,
  ownerViewKey,
  updateFinanceFolder,
  type FinanceOwner,
} from './api';

/**
 * The folder dialogs of the Documents card (lazy chunk): the knowledge base's folder and "Move
 * to…" dialogs with finance's own API calls (no "Visible to": every finance admin sees every
 * folder), and the delete question. Each write refreshes the owner's finance queries (a client's,
 * or the organisation's on `/finance`, Phase 32 E).
 */
export function FolderDialogs({
  owner,
  action,
  folders,
  onClose,
}: {
  owner: FinanceOwner;
  action: FolderAction;
  folders: FinanceFolder[] | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: ownerViewKey(owner) });
  const done = () => {
    refresh();
    onClose();
  };

  if (action.kind === 'new' || action.kind === 'rename') {
    const folder = action.kind === 'rename' ? action.folder : undefined;
    return (
      <FolderDialog
        folder={folder}
        parent={null}
        canChooseVisibility={false}
        save={async ({ name }) => {
          if (folder) {
            if (name !== undefined) await updateFinanceFolder(folder.id, { name });
          } else {
            await createFinanceFolder(owner, {
              name: name ?? '',
              parentId: action.kind === 'new' ? action.parentId : null,
            });
          }
        }}
        onDone={done}
        onClose={onClose}
      />
    );
  }
  if (action.kind === 'move') {
    return (
      <MoveDialog
        folders={folders}
        name={action.folder.name}
        currentFolderId={action.folder.parentId}
        movingFolderId={action.folder.id}
        clientItemMessage={t('knowledge.folders.moveFailed')}
        onMove={async (parentId) => {
          await updateFinanceFolder(action.folder.id, { parentId });
          done();
        }}
        onClose={onClose}
      />
    );
  }
  return <DeleteFolder folder={action.folder} onDeleted={done} onClose={onClose} />;
}

function DeleteFolder({
  folder,
  onDeleted,
  onClose,
}: {
  folder: FinanceFolder;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await deleteFinanceFolder(folder.id);
      onDeleted();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <SheetDialog
      onEscape={(event) => {
        event.preventDefault();
        onClose();
      }}
      testId="finance-folder-delete"
    >
      <PanelHeader
        onClose={onClose}
        compactBelow={641}
        backLabel={t('financeDocuments.sheet.back')}
      >
        {null}
      </PanelHeader>
      <div className="flex flex-col gap-4 px-4 py-4 min-[641px]:px-6 min-[641px]:py-5">
        <SheetDialogTitle className="break-words text-medium font-semibold">
          {t('financeDocuments.card.deleteFolder')}
        </SheetDialogTitle>
        <PanelNotice text={t('financeDocuments.card.deleteFolderConfirm', { name: folder.name })}>
          <Button variant="ghost" onClick={onClose}>
            {t('financeDocuments.card.cancel')}
          </Button>
          <Button variant="destructive" aria-disabled={busy} onClick={() => void remove()}>
            {t('financeDocuments.card.delete')}
          </Button>
        </PanelNotice>
        {failed && (
          <p role="alert" className="text-button text-error-ink">
            {t('financeDocuments.card.deleteFolderFailed')}
          </p>
        )}
      </div>
    </SheetDialog>
  );
}
