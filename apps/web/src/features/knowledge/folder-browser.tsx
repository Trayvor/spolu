import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KnowledgeFolderDto, KnowledgeType } from '@spolu/shared';
import { MoreIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PanelNotice } from '@/components/ui/panel-notice';
import { deleteFolder, groupFoldersQuery, groupKnowledgeQuery, updateFolder } from './api';
import { Breadcrumbs, type Crumb } from './breadcrumbs';
import { FolderDialog, folderError } from './folder-dialog';
import { childFolders, folderPath } from './folder-tree';
import { ChevronIcon, FolderIcon, LockIcon } from './icons';
import { KnowledgeList } from './knowledge-list';
import { MoveDialog } from './move-dialog';

type Action =
  | { kind: 'edit'; folder: KnowledgeFolderDto }
  | { kind: 'move'; folder: KnowledgeFolderDto }
  | { kind: 'delete'; folder: KnowledgeFolderDto }
  | null;

/** One folder row: the full-row button opens it; the "…" menu renames, moves or deletes it. */
function FolderRow({
  folder,
  onOpen,
  onAction,
}: {
  folder: KnowledgeFolderDto;
  onOpen: (id: string) => void;
  onAction: (action: Action) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative flex items-center gap-4 px-4 py-3 hover:bg-muted/50 sm:px-5">
      <button
        type="button"
        aria-label={t('knowledge.folders.open', { name: folder.name })}
        onClick={() => onOpen(folder.id)}
        className="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      />
      <div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground sm:size-10"
        >
          <FolderIcon />
        </span>
        <span className="min-w-0 flex-1 truncate text-button font-semibold">{folder.name}</span>
        {folder.visibility === 'admins' && (
          <Badge variant="outline">
            <LockIcon />
            {t('knowledge.visibility.admins')}
          </Badge>
        )}
        <span className="text-muted-foreground">
          <ChevronIcon />
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('knowledge.folders.more', { name: folder.name })}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent"
        >
          <MoreIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onAction({ kind: 'edit', folder })}>
            {t('knowledge.folders.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction({ kind: 'move', folder })}>
            {t('knowledge.folders.moveTo')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onAction({ kind: 'delete', folder })}
            className="text-error-ink"
          >
            {t('knowledge.folders.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * One folder of a group (null: the top level): breadcrumbs (`rootCrumbs` first, then the path),
 * the subfolders by name, then the folder's items of the ticked types, newest first. When the
 * open folder disappears (deleted, or hidden from this viewer) `onFolderGone` fires.
 */
export function FolderBrowser({
  groupId,
  folderId,
  types,
  rootCrumbs,
  onOpenFolder,
  onOpenItem,
  onFolderGone,
  canSeeAdmins,
  emptyHint,
  showItemGroup,
}: {
  groupId: string;
  folderId: string | null;
  types: KnowledgeType[];
  /** The crumbs before the folders; the last one opens the top level. */
  rootCrumbs: Crumb[];
  onOpenFolder: (id: string | null) => void;
  onOpenItem: (id: string) => void;
  onFolderGone: () => void;
  canSeeAdmins: boolean;
  /** Shown when the folder has no subfolders and no items, and no type is ticked. */
  emptyHint: ReactNode;
  showItemGroup?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const folders = useQuery(groupFoldersQuery(groupId));
  const items = useInfiniteQuery(groupKnowledgeQuery(groupId, { types, folder: folderId }));
  const [action, setAction] = useState<Action>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const all = folders.data ?? [];
  const path = folderId ? folderPath(all, folderId) : [];
  const children = childFolders(all, folderId, i18n.language);
  const gone = folderId !== null && folders.isSuccess && path.length === 0;
  useEffect(() => {
    if (gone) onFolderGone();
  }, [gone, onFolderGone]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: groupFoldersQuery(groupId).queryKey });
    void client.invalidateQueries({ queryKey: ['knowledge', 'group', groupId] });
  };

  const crumbs: Crumb[] = [
    ...rootCrumbs.map((crumb, i) =>
      i === rootCrumbs.length - 1 ? { ...crumb, onClick: () => onOpenFolder(null) } : crumb,
    ),
    ...path.map((folder) => ({
      key: folder.id,
      label: folder.name,
      onClick: () => onOpenFolder(folder.id),
    })),
  ];

  async function remove(folder: KnowledgeFolderDto) {
    setActionError(null);
    try {
      await deleteFolder(folder.id);
      setAction(null);
      refresh();
    } catch (caught) {
      setActionError(folderError(caught, t, 'knowledge.folders.deleteFailed'));
    }
  }

  const parentOf = (folder: KnowledgeFolderDto) =>
    folder.parentId ? (all.find((f) => f.id === folder.parentId) ?? null) : null;

  const empty =
    children.length > 0 ? null : types.length > 0 ? (
      <p className="py-6 text-button text-muted-foreground">{t('knowledge.folders.noItemsHere')}</p>
    ) : (
      emptyHint
    );

  return (
    <div className="flex flex-col gap-4">
      {(rootCrumbs.length > 1 || path.length > 0) && <Breadcrumbs crumbs={crumbs} />}
      {action?.kind === 'delete' && (
        <div>
          <PanelNotice text={t('knowledge.folders.deleteConfirm', { name: action.folder.name })}>
            <Button variant="ghost" onClick={() => setAction(null)}>
              {t('knowledge.folders.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void remove(action.folder)}>
              {t('knowledge.folders.delete')}
            </Button>
          </PanelNotice>
          {actionError && <p className="mt-2 text-button text-error-ink">{actionError}</p>}
        </div>
      )}
      {children.length > 0 && (
        <Card className="w-full gap-0 divide-y divide-border overflow-hidden py-0">
          {children.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              onOpen={onOpenFolder}
              onAction={(next) => {
                setActionError(null);
                setAction(next);
              }}
            />
          ))}
        </Card>
      )}
      {(folderId === null || !gone) && (
        <KnowledgeList query={items} onOpen={onOpenItem} showGroup={showItemGroup} empty={empty} />
      )}
      {action?.kind === 'edit' && (
        <FolderDialog
          groupId={groupId}
          folder={action.folder}
          parent={parentOf(action.folder)}
          canChooseVisibility={canSeeAdmins}
          onDone={() => {
            setAction(null);
            refresh();
          }}
          onClose={() => setAction(null)}
        />
      )}
      {action?.kind === 'move' && (
        <MoveDialog
          groupId={groupId}
          name={action.folder.name}
          currentFolderId={action.folder.parentId}
          movingFolderId={action.folder.id}
          clientItemMessage={t('knowledge.folders.clientItemInside')}
          onMove={async (parentId) => {
            await updateFolder(action.folder.id, { parentId });
            setAction(null);
            refresh();
          }}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}
