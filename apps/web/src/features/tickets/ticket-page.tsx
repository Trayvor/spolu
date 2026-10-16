import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { Me, TicketDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { clientGroups, isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { useMediaQuery } from '@/lib/use-media-query';
import { ticketQuery } from './api';
import { AssignClient } from './assign-client';
import { ChevronDown } from './icons';
import { TicketChat } from './ticket-chat';
import { StatusControl, TicketFields } from './ticket-fields';
import { TicketFollowers } from './ticket-followers';
import { ticketTitle } from './ticket-list';
import { useTicketEvents } from './use-ticket-events';

/** Route component of `/tickets/$ticketId`; the loader has read the ticket (404: not found). */
export function TicketPageRoute() {
  const { ticketId } = useParams({ strict: false });
  return <TicketPage ticketId={ticketId ?? ''} />;
}

/**
 * The ticket page (Phase 21): the ticket's number, status and client over its subject, then from
 * 1024 px two columns, the details on the left (text, fields, client, followers, tasks) and the
 * ticket chat filling the rest of the window on the right. Below 1024 px the details fold into a
 * summary above the chat. A ticket without a client shows "No client yet" (with Assign client
 * for admins) and no chat. Admins change the status, the fields and the client in place.
 */
export function TicketPage({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation();
  const me = useSession();
  const { data: ticket } = useQuery(ticketQuery(ticketId));
  const wide = useMediaQuery('(min-width: 1024px)');
  useTicketEvents(null);
  if (!ticket || !me) return null;

  const admin = isAdmin(me);
  const readsGroup =
    admin || (ticket.groupId !== null && clientGroups(me).some((g) => g.id === ticket.groupId));
  const details = <TicketDetails ticket={ticket} me={me} />;

  return (
    <div className="flex flex-1 flex-col gap-3">
      <TicketHeader ticket={ticket} admin={admin} readsGroup={readsGroup} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4">
        {wide ? (
          <aside
            aria-label={t('tickets.page.details')}
            className="flex w-[360px] shrink-0 flex-col gap-6 self-start rounded-xl bg-card p-5 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto"
          >
            {details}
          </aside>
        ) : (
          <details className="group rounded-xl bg-card" open={ticket.groupId === null}>
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-button font-semibold">
              {t('tickets.page.details')}
              <span className="text-muted-foreground group-open:rotate-180">
                <ChevronDown />
              </span>
            </summary>
            <div className="flex flex-col gap-6 border-t-2 border-border px-4 pt-4 pb-5">
              {details}
            </div>
          </details>
        )}
        {ticket.groupId !== null && ticket.channelId !== null ? (
          <div data-testid="ticket-chat" className="relative min-h-[60dvh] flex-1 lg:min-h-[480px]">
            <div className="absolute inset-0">
              <TicketChat ticketId={ticket.id} groupId={ticket.groupId} readsGroup={readsGroup} />
            </div>
          </div>
        ) : (
          ticket.groupId === null && <NoClient ticket={ticket} admin={admin} />
        )}
      </div>
    </div>
  );
}

function TicketHeader({
  ticket,
  admin,
  readsGroup,
}: {
  ticket: TicketDto;
  admin: boolean;
  readsGroup: boolean;
}) {
  const { t } = useTranslation();
  const title = ticketTitle({ subject: ticket.subject, excerpt: ticket.body });
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-button font-semibold text-muted-foreground tabular-nums">
          {t('tickets.page.number', { number: ticket.number })}
        </span>
        <StatusControl ticket={ticket} editable={admin} />
        {ticket.groupId !== null &&
          ticket.groupName !== null &&
          (readsGroup ? (
            <Link
              to="/groups/$groupId/tickets"
              params={{ groupId: ticket.groupId }}
              className="text-tiny font-semibold underline underline-offset-4 hover:text-neutral"
            >
              {ticket.groupName}
            </Link>
          ) : (
            <span className="text-tiny font-semibold">{ticket.groupName}</span>
          ))}
      </div>
      <h1 className="text-medium leading-tight font-semibold break-words">
        {title || t('tickets.row.noSubject')}
      </h1>
    </header>
  );
}

/** Left column (or the folded summary): text and fields, client, followers, tasks. */
function TicketDetails({ ticket, me }: { ticket: TicketDto; me: Me }) {
  const { t } = useTranslation();
  const admin = isAdmin(me);
  const [moving, setMoving] = useState(false);
  return (
    <>
      <TicketFields ticket={ticket} editable={admin} />
      {admin && ticket.groupId !== null && (
        <Section>
          {moving ? (
            <AssignClient
              ticketId={ticket.id}
              currentGroupId={ticket.groupId}
              onDone={() => setMoving(false)}
            />
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-micro font-semibold text-muted-foreground">
                  {t('tickets.fields.client')}
                </span>
                <span className="truncate text-button font-semibold">{ticket.groupName}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setMoving(true)}>
                {t('tickets.assign.change')}
              </Button>
            </div>
          )}
        </Section>
      )}
      <Section>
        <TicketFollowers ticketId={ticket.id} following={ticket.following} />
      </Section>
      {ticket.taskCount > 0 && (
        <Section>
          <p className="text-button text-muted-foreground">
            {t('tickets.page.turnedInto', { count: ticket.taskCount })}
          </p>
        </Section>
      )}
    </>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <div className="border-t-2 border-border pt-5">{children}</div>;
}

/** In the chat's place while the ticket has no client: who can act, and Assign client. */
function NoClient({ ticket, admin }: { ticket: TicketDto; admin: boolean }) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="no-client"
      className="flex flex-1 flex-col gap-4 self-start rounded-xl bg-card p-5 lg:max-w-[560px]"
    >
      <h2 id="no-client" className="text-body font-semibold">
        {t('tickets.noClient.title')}
      </h2>
      <p className="text-button text-muted-foreground">
        {t(admin ? 'tickets.noClient.adminHint' : 'tickets.noClient.hint')}
      </p>
      {admin && <AssignClient ticketId={ticket.id} currentGroupId={null} />}
    </section>
  );
}
