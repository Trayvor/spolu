import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { KnowledgeFolderDto } from '@spolu/shared';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { treeRows } from './folder-tree';

const TOP = '';

/**
 * "Folder": the group's folders as one native select under "Top level", indented by depth; an
 * admins-only folder says so. `value` null is the top level.
 */
export function FolderSelect({
  folders,
  value,
  onChange,
}: {
  folders: KnowledgeFolderDto[];
  value: string | null;
  onChange: (folderId: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-2.5">
      <Label htmlFor={id}>{t('knowledge.folders.label')}</Label>
      <Select
        id={id}
        value={value ?? TOP}
        onChange={(event) => onChange(event.target.value === TOP ? null : event.target.value)}
      >
        <option value={TOP}>{t('knowledge.folders.topLevel')}</option>
        {treeRows(folders, i18n.language).map(({ folder, depth }) => (
          <option key={folder.id} value={folder.id}>
            {`${'   '.repeat(depth + 1)}${folder.name}${
              folder.visibility === 'admins' ? ` (${t('knowledge.visibility.admins')})` : ''
            }`}
          </option>
        ))}
      </Select>
    </div>
  );
}
