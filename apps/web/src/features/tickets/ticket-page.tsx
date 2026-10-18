import { Suspense, useEffect, type MouseEvent, type ReactNode } from 'react';
import { useMarkSeen } from '@/lib/use-mark-seen';
import { UnseenBanner, useOpenSummary } from '@/features/unseen/banner';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { Me, TicketDto } from '@spolu/shared';
import { MessageSkeletons, Skeleton } from '@/components/ui/skeleton';
import { clientGroups, isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { ApiError } from '@/lib/api';
import { useMediaQuery } from '@/lib/use-media-query';
import { useUpdateSearch } from '@/lib/use-update-search';
import { useNamespaces } from '@/i18n/namespaces';
import { seesTime, TicketMyTime } from '@/features/tasks/my-time';
import { askForTime, ticketAskTitle } from '@/features/tasks/time-queue';
import { OpenInClaude } from '@/features/open-in-claude/open-in-claude';
import { NotFoundPage } from '@/routes/not-found';
import { ticketQuery } from './api';
import { ChevronDown, ChevronLeft } from './icons';
import { TicketChat } from './ticket-chat';
import { TicketEgrantNotes } from './ticket-egrant';
import { StatusControl, TicketFields } from './ticket-fields';
import { TicketAssignees } from './ticket-assignees';
import { TicketTasks } from './ticket-tasks';
import { ticketTitle } from './ticket-list';
import { useTicketEvents } from './use-ticket-events';

/** Route component of `/tickets/$ticketId`; the loader has read the ticket (404: not found). */
export function TicketPageRoute() {
  const { ticketId } = useParams({ strict: false });
  return <TicketPage ticketId={ticketId ?? ''} />;
}

/**
 * The ticket page (Phase 21): the ticket's number, status and client over its subject, then from
 * 1024 px two columns, the details on the left (text, fields with the client, riešitelia, tasks)
 * and the ticket chat filling the rest of the window on the right; "Back" above returns to the
 * list. Below 1024 px the details fold into a summary above the chat. A ticket without a client
 * shows "No client yet" (admins choose the client in Edit) and no chat. Admins change the status
 * from the header, the client and the fields in the details' Edit form. A ticket that answers
 * 404 later (moved to a client the viewer cannot read) shows the not-found page.
 */
export function TicketPage({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation();
  const me = useSession();
  const { data: cached, error } = useQuery(ticketQuery(ticketId));
  const wide = useMediaQuery('(min-width: 1024px)');
  useTicketEvents(null);
  useTimeParam(cached, me);
  // 2026-10-17: open and visible, its changes are seen; 2026-10-18: after what changed was
  // fetched for the banner.
  const opened = useOpenSummary(cached ? { kind: 'ticket', id: ticketId } : null);
  useMarkSeen(
    cached ? { kind: 'ticket', id: ticketId, channelId: cached.channelId } : null,
    opened.ready,
  );
  // Moved out of the viewer's reach while open: never keep showing the old ticket.
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  const ticket = cached;
  if (!ticket || !me) return <TicketPageSkeleton label={t('tickets.list.loading')} />;

  const admin = isAdmin(me);
  const readsGroup =
    admin || (ticket.groupId !== null && clientGroups(me).some((g) => g.id === ticket.groupId));
  const details = <TicketDetails ticket={ticket} me={me} />;

  return (
    <div className="flex flex-1 flex-col gap-3">
      <TicketHeader ticket={ticket} admin={admin} readsGroup={readsGroup} me={me} />
      <UnseenBanner open={opened} />
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
              <TicketChat
                ticketId={ticket.id}
                groupId={ticket.groupId}
                readsGroup={readsGroup}
                requesterName={ticket.requester.name}
                draftLabel={
                  admin ? { number: ticket.number, client: ticket.groupName ?? '' } : null
                }
              />
            </div>
          </div>
        ) : (
          ticket.groupId === null && <NoClient admin={admin} />
        )}
      </div>
    </div>
  );
}

/** The ticket page's shape in grey (title, summary, chat rows) while the ticket loads. */
function TicketPageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-1 flex-col gap-3">
      <Skeleton className="h-6 w-2/3 bg-secondary" />
      <Skeleton className="h-12 w-full rounded-xl bg-card" />
      <div className="rounded-xl bg-card py-3">
        <MessageSkeletons rows={3} />
      </div>
    </div>
  );
}

/**
 * "Back" over the header: one step back in the app's history when the ticket was opened from
 * inside the app (the list keeps its filters, which live in the URL), else the viewer's list:
 * the global view for admins, the group's Tickets tab for a client of the ticket's group, My
 * tickets for anyone else.
 */
function BackLink({ ticket, me }: { ticket: TicketDto; me: Me }) {
  const { t } = useTranslation();
  const router = useRouter();
  const groupId = ticket.groupId;
  const toGroup =
    !isAdmin(me) && groupId !== null && clientGroups(me).some((g) => g.id === groupId);
  const goBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!router.history.canGoBack()) return;
    event.preventDefault();
    router.history.back();
  };
  const className =
    'inline-flex min-h-11 items-center gap-1.5 self-start text-tiny font-semibold text-muted-foreground hover:text-foreground';
  const label = (
    <>
      <ChevronLeft />
      {t('tickets.page.back')}
    </>
  );
  return toGroup ? (
    <Link to="/groups/$groupId/tickets" params={{ groupId }} onClick={goBack} className={className}>
      {label}
    </Link>
  ) : (
    <Link to="/tickets" onClick={goBack} className={className}>
      {label}
    </Link>
  );
}

function TicketHeader({
  ticket,
  admin,
  readsGroup,
  me,
}: {
  ticket: TicketDto;
  admin: boolean;
  readsGroup: boolean;
  me: Me;
}) {
  const { t } = useTranslation();
  const title = ticketTitle({ subject: ticket.subject, excerpt: ticket.body });
  return (
    <header className="flex flex-col gap-2">
      <BackLink ticket={ticket} me={me} />
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
        {admin && (
          <div className="ml-auto">
            <OpenInClaude source={{ kind: 'ticket', id: ticket.id }} />
          </div>
        )}
      </div>
      <h1 className="text-medium leading-tight font-semibold break-words">
        {title || t('tickets.row.noSubject')}
      </h1>
    </header>
  );
}

/** Left column (or the folded summary): text and fields (with the client), riešitelia, tasks. */
function TicketDetails({ ticket, me }: { ticket: TicketDto; me: Me }) {
  const { t } = useTranslation();
  return (
    <>
      {/* Phase 33 part P3: the eGrant project's state, for admins and the group's clients. */}
      <TicketEgrantNotes ticket={ticket} />
      <TicketFields ticket={ticket} editable={isAdmin(me)} />
      <Section>
        <TicketAssignees ticket={ticket} />
      </Section>
      {/* Phase 32: time on the ticket, with or without a client (owner decision 24). */}
      {seesTime(
        me,
        ticket.assignees.map((p) => p.id),
      ) && (
        <Section>
          <Suspense fallback={null}>
            <TicketTime ticket={ticket} />
          </Suspense>
        </Section>
      )}
      {ticket.tasks !== null && ticket.groupId !== null ? (
        <TicketTasks ticket={ticket} groupId={ticket.groupId} tasks={ticket.tasks} />
      ) : (
        // A requester sees only how many tasks the ticket became, without links.
        ticket.taskCount > 0 && (
          <Section>
            <p className="text-button text-muted-foreground">
              {t('tickets.page.turnedInto', { count: ticket.taskCount })}
            </p>
          </Section>
        )
      )}
    </>
  );
}

/** "My time" with the texts of the time dialog (the `tasks` namespace, loaded here on first use). */
function TicketTime({ ticket }: { ticket: TicketDto }) {
  useNamespaces(['tasks']);
  return <TicketMyTime ticket={ticket} />;
}

/**
 * `?time=1` (the time request's push and email, Phase 32): an admin riešiteľ of the ticket gets
 * the time dialog; the param is dropped so Back or a reload does not ask again.
 */
function useTimeParam(ticket: TicketDto | undefined, me: Me | null) {
  const updateSearch = useUpdateSearch();
  const asked = useLocation({ select: (l) => (l.search as Record<string, unknown>).time });
  const ready = ticket !== undefined && me !== null;
  useEffect(() => {
    if (asked === undefined || !ticket || !me) return;
    updateSearch(
      (search) => {
        delete search.time;
      },
      { replace: true },
    );
    const riesitel = ticket.assignees.some((p) => p.id === me.id);
    if (String(asked) === '1' && isAdmin(me) && riesitel) {
      askForTime({
        kind: 'ticket',
        id: ticket.id,
        groupId: ticket.groupId,
        title: ticketAskTitle(ticket.number, ticket.subject),
      });
    }
    // Once per arrival of the param, when the ticket is there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, ready]);
}

function Section({ children }: { children: ReactNode }) {
  return <div className="border-t-2 border-border pt-5">{children}</div>;
}

/** In the chat's place while the ticket has no client: who assigns one, and how. */
function NoClient({ admin }: { admin: boolean }) {
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
    </section>
  );
}
