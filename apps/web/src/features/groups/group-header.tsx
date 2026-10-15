import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Group } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { GroupForm } from './group-form';
import { GroupLogo } from './group-logo';

/** One line: logo, name (a link to the instance) and (admins) Edit. Editing swaps the line for the form. */
export function GroupHeader({ group, admin }: { group: Group; admin: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="max-w-[720px]">
        <GroupForm
          group={group}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <GroupLogo
          groupId={group.id}
          name={group.name}
          hasLogo={group.hasLogo}
          version={group.updatedAt}
          size={32}
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
      </div>
      {admin && (
        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
          {t('group.edit')}
        </Button>
      )}
    </div>
  );
}
