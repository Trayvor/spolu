import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Group } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { GroupForm } from './group-form';
import { GroupLogo } from './group-logo';

/** One line: logo, name, eGrant link and (admins) Edit. Editing swaps the line for the form. */
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
          size={40}
        />
        <div className="min-w-0">
          <h1 className="truncate text-medium leading-tight font-semibold">{group.name}</h1>
          <a
            href={group.egrantUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="block truncate text-button text-muted-foreground hover:text-ink-hover"
          >
            {group.egrantUrl}
          </a>
        </div>
      </div>
      {admin && (
        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
          {t('group.edit')}
        </Button>
      )}
    </div>
  );
}
