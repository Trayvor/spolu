import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Group } from '@spolu/shared';
import { ExternalLinkIcon, SettingsIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { GroupBell } from '@/features/notifications/mode-menu';
import { GroupForm } from './group-form';
import { GroupLogo } from './group-logo';
import { GroupStatus } from './group-status';

// The bell's look (`mode-menu.tsx`): a 38 px round muted icon button with a 44 px tap area.
const iconButton =
  "relative inline-flex size-[38px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--duration-fast) after:absolute after:-inset-[3px] after:rounded-full after:content-[''] hover:bg-surface-3 hover:text-foreground";

/**
 * One line: logo, name, a "Deactivated" badge, the bell and (admins) Edit as a gear icon button
 * right after it (2026-10-21). For admins, who may edit the group, the name opens the edit form
 * too and the instance (the admin group has none) is a small external-link icon after the name;
 * for everyone else the name is the link to the instance, or plain text. Editing swaps the line
 * for the form, with "Deactivate" under it for a client group. A deactivated group shows the
 * notice with "Reactivate" under the line.
 */
export function GroupHeader({ group, admin }: { group: Group; admin: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  const clientGroup = group.kind === 'client';
  if (editing) {
    return (
      <div className="flex max-w-[720px] flex-col gap-4">
        <GroupForm
          group={group}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
        {clientGroup && !group.deactivatedAt && <GroupStatus group={group} />}
      </div>
    );
  }
  const line = (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <GroupLogo
          groupId={group.id}
          name={group.name}
          hasLogo={group.hasLogo}
          version={group.updatedAt}
          size={32}
          admin={group.kind === 'admin'}
        />
        <h1 className="min-w-0 truncate text-medium leading-tight font-semibold">
          {admin ? (
            <button
              type="button"
              title={t('group.edit')}
              className="max-w-full cursor-pointer truncate text-left hover:underline"
              onClick={() => setEditing(true)}
            >
              {group.name}
            </button>
          ) : group.egrantUrl ? (
            <a
              href={group.egrantUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={group.egrantUrl}
              className="hover:underline"
            >
              {group.name}
            </a>
          ) : (
            group.name
          )}
        </h1>
        {group.deactivatedAt && (
          <Badge variant="secondary" data-deactivated="">
            {t('group.status.deactivated')}
          </Badge>
        )}
      </div>
      {/* 38px buttons in a 32px line: the negative margin keeps the header height. */}
      <div className="-my-[3px] -ml-2 flex shrink-0 items-center">
        {admin && group.egrantUrl && (
          <a
            href={group.egrantUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={group.egrantUrl}
            aria-label={t('group.openInstance')}
            className={iconButton}
          >
            <ExternalLinkIcon />
          </a>
        )}
        <GroupBell groupId={group.id} />
        {admin && (
          <button
            type="button"
            aria-label={t('group.edit')}
            title={t('group.edit')}
            className={iconButton}
            onClick={() => setEditing(true)}
          >
            <SettingsIcon />
          </button>
        )}
      </div>
    </div>
  );
  if (!group.deactivatedAt) return line;
  return (
    <div className="flex flex-col gap-3">
      {line}
      {admin && clientGroup && <GroupStatus group={group} />}
    </div>
  );
}
