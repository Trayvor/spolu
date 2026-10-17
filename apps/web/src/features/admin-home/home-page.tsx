import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/use-session';
import { useMediaQuery } from '@/lib/use-media-query';
import { homeKeys, sidebarQuery } from './api';
import {
  useAssignedCard,
  useMeetingsCard,
  useMentionsCard,
  useRemindersCard,
  useTicketsCard,
} from './cards';
import { ClientSidebarList, SidebarRowsPlaceholder } from './client-sidebar';
import { CountCard } from './count-card';
import { CountTile } from './count-tile';
import { firstName, greetingKey } from './greeting';
import { useAdminActivityRefetch } from './use-admin-activity';

const CARD_KEYS = [
  homeKeys.tasks,
  homeKeys.mentions,
  homeKeys.reminders,
  homeKeys.meetings,
] as const;
const PHONE_KEYS = [...CARD_KEYS, homeKeys.sidebar] as const;
const TICKET_KEYS = [homeKeys.tickets] as const;

/** Under 1024 px the client list is part of the home screen (there is no sidebar). */
function PhoneClientList() {
  const { t } = useTranslation();
  const sidebar = useQuery(sidebarQuery);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-body font-semibold">{t('adminHome.home.clients')}</h2>
      {sidebar.isPending ? (
        <SidebarRowsPlaceholder />
      ) : sidebar.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-button text-muted-foreground">{t('adminHome.shell.loadError')}</p>
          <Button variant="secondary" size="sm" onClick={() => void sidebar.refetch()}>
            {t('adminHome.shell.retry')}
          </Button>
        </div>
      ) : (
        <div className="rounded-xl bg-card p-2">
          <ClientSidebarList clients={sidebar.data} rowHeight={48} />
        </div>
      )}
    </section>
  );
}

/**
 * The admin dashboard: a greeting, then "Tickets" (wide: mine and those without a client), "My
 * tasks" (wide), "Meetings" (wide, Phase 30), "Upcoming reminders" and "Mentions" (half each; Mentions takes the row when
 * there is no reminder source). Under 1024 px the cards become count tiles (two per row) that open
 * their lists, followed by the client list. The Tickets card refetches on ticket events only.
 */
export function HomePage() {
  const { t } = useTranslation();
  const name = firstName(useSession()?.name ?? '');
  const wide = useMediaQuery('(min-width: 1024px)');
  useAdminActivityRefetch(wide ? CARD_KEYS : PHONE_KEYS);
  useAdminActivityRefetch(TICKET_KEYS, { kinds: [], chatRead: false, tickets: true });
  const tickets = useTicketsCard();
  const assigned = useAssignedCard();
  const reminders = useRemindersCard();
  const mentions = useMentionsCard();
  const meetings = useMeetingsCard();
  const cards = [tickets, assigned, meetings, ...(reminders ? [reminders] : []), mentions];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-medium font-semibold">
        {t(`adminHome.home.greeting.${greetingKey(new Date())}`, { name })}
      </h1>
      {wide ? (
        <>
          <CountCard {...tickets} />
          <CountCard {...assigned} />
          <CountCard {...meetings} />
          <div className={reminders ? 'grid grid-cols-2 gap-4' : 'grid grid-cols-1 gap-4'}>
            {reminders && <CountCard {...reminders} />}
            <CountCard {...mentions} />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {cards.map((card) => (
              <CountTile key={card.title} {...card} />
            ))}
          </div>
          <PhoneClientList />
        </>
      )}
    </div>
  );
}
