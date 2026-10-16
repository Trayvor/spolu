import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { followersQuery, useFollow } from './api';
import { CheckIcon } from './icons';

/**
 * The ticket's followers (avatars and names) and the viewer's Follow toggle: a `secondary` pill
 * "Follow", or the filled ink pill with a check "Following" (`aria-pressed`), like the groups
 * list's manager toggle. Anyone who reads the ticket may follow it.
 */
export function TicketFollowers({ ticketId, following }: { ticketId: string; following: boolean }) {
  const { t } = useTranslation();
  const followers = useQuery(followersQuery(ticketId)).data;
  const toggle = useFollow(ticketId);
  const on = toggle.isPending ? toggle.variables === true : following;

  return (
    <section aria-labelledby="ticket-followers" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="ticket-followers" className="text-button font-semibold">
          {t('tickets.followers.title', { count: followers?.length ?? 0 })}
        </h2>
        <Button
          size="sm"
          variant={on ? 'default' : 'secondary'}
          aria-pressed={on}
          disabled={toggle.isPending}
          className={cn(on && 'pl-3')}
          onClick={() => toggle.mutate(!following)}
        >
          {on && <CheckIcon />}
          {t(on ? 'tickets.followers.following' : 'tickets.followers.follow')}
        </Button>
      </div>
      {followers && followers.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {followers.map((f) => (
            <li key={f.id} className="flex min-w-0 items-center gap-2 text-tiny">
              <Avatar userId={f.id} name={f.name} size={24} />
              <span className="truncate">{f.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        followers && (
          <p className="text-micro text-muted-foreground">{t('tickets.followers.none')}</p>
        )
      )}
      {toggle.isError && (
        <p role="alert" className="text-micro text-error-ink">
          {t('errors.generic')}
        </p>
      )}
    </section>
  );
}
