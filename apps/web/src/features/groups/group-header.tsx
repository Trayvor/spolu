import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Group } from '@spolu/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GroupBell } from '@/features/notifications/mode-menu';
import { GroupForm } from './group-form';
import { GroupLogo } from './group-logo';
import { GroupStatus } from './group-status';

/**
 * One line: logo, name (a link to the instance; the admin group has none), a "Deactivated"
 * badge and (admins) Edit. Editing swaps the line for the form, with "Deactivate" under it for a
 * client group. A deactivated group shows the notice with "Reactivate" under the line.
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
          {group.egrantUrl ? (
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
      {/* 38px button in a 32px line: the negative margin keeps the header height. */}
      <GroupBell groupId={group.id} className="-my-[3px]" />
      {admin && (
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto shrink-0"
          onClick={() => setEditing(true)}
        >
          {t('group.edit')}
        </Button>
      )}
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
