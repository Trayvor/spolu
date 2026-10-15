import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { groupQuery } from './api';
import { GroupForm } from './group-form';
import { GroupLogo } from './group-logo';
import { InviteBox } from './invite-box';
import { MembersList } from './members-list';

export function GroupRoute() {
  const { groupId } = useParams({ strict: false });
  return groupId ? <GroupPage groupId={groupId} /> : null;
}

/** One group: header, the invite link (admins) and members. Edit opens the form inline. */
export function GroupPage({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const admin = isAdmin(useSession());
  const { data: group } = useQuery(groupQuery(groupId));
  const [editing, setEditing] = useState(false);

  if (!group) return null;
  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      {editing ? (
        <GroupForm
          group={group}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <div className="flex flex-col gap-4 min-[641px]:flex-row min-[641px]:items-center min-[641px]:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <GroupLogo
              groupId={group.id}
              name={group.name}
              hasLogo={group.hasLogo}
              version={group.updatedAt}
              size={56}
            />
            <div className="min-w-0">
              <h1 className="text-medium leading-tight font-semibold break-words">{group.name}</h1>
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
            <Button className="w-full min-[641px]:w-auto" onClick={() => setEditing(true)}>
              {t('group.edit')}
            </Button>
          )}
        </div>
      )}
      {admin && group.inviteUrl && <InviteBox groupId={group.id} inviteUrl={group.inviteUrl} />}
      <MembersList groupId={group.id} admin={admin} />
    </div>
  );
}
