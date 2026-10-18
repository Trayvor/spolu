import { useTranslation } from 'react-i18next';
import type { ProjectColor, TimelineEventDto } from '@spolu/shared';
import { cn } from '@/lib/utils';
import { DonePile } from './done-pile';
import { TaskRow, TicketRow } from './event-rows';
import { formatEventDate, ProjectDot } from './project-dot';

/** The project's colour as the dot's 3 px ring (decision 27). */
const RING: Record<ProjectColor, string> = {
  purple: 'ring-brand-purple',
  pink: 'ring-brand-pink',
  blue: 'ring-brand-blue',
  coral: 'ring-brand-coral',
  green: 'ring-success',
};

/**
 * One event of the timeline strip (spec §7.2): its dot on the line, the date, the name (opens the
 * event sheet; on phones the whole top is its tap area), the project in the all-projects view,
 * then, from 641 px, its open tasks and tickets (5 each) and the done pile.
 */
export function TimelineEvent({
  groupId,
  event,
  when,
  gap,
  showProject,
  today,
  onOpen,
}: {
  groupId: string;
  event: TimelineEventDto;
  when: 'past' | 'today' | 'coming';
  /** The gap mark on the line before this event ("4 months"), if any. */
  gap: string | null;
  showProject: boolean;
  today: string;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`projects.timeline.${key}`, options);
  const color = event.project.color ?? 'purple';
  const more =
    event.openTaskCount > event.openTasks.length ||
    event.openTicketCount > event.openTickets.length;
  return (
    <li data-event={event.id} className="flex w-[200px] shrink-0 flex-col max-[640px]:w-[160px]">
      <div className="relative flex flex-col gap-1 px-3 pb-3">
        {/* The line through the dot; a gap before this event breaks it halfway from the last dot. */}
        <div aria-hidden="true" className="relative flex h-8 items-center">
          <span className="absolute inset-x-[-12px] top-1/2 h-0.5 -translate-y-1/2 bg-border" />
          {gap && (
            <span className="absolute top-1/2 left-[calc(-50%-12px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-card px-1.5 text-micro whitespace-nowrap text-muted-foreground">
              {gap}
            </span>
          )}
          <span
            data-when={when}
            className={cn(
              'relative rounded-full ring-[3px]',
              RING[color],
              when === 'coming'
                ? 'size-3.5 border-2 border-foreground bg-card'
                : 'size-3.5 bg-foreground',
              when === 'today' && 'size-4 outline-2 outline-offset-[5px] outline-foreground',
              'max-[640px]:size-4',
            )}
          />
        </div>
        <time dateTime={event.occursOn} className="text-tiny text-muted-foreground tabular-nums">
          {formatEventDate(event.occursOn, i18n.language)}
        </time>
        <h3 className="text-button leading-snug font-semibold">
          <button
            type="button"
            onClick={onOpen}
            className="line-clamp-2 text-left after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-ring"
          >
            {event.name}
          </button>
        </h3>
        {showProject && (
          <span className="flex min-w-0 items-center gap-1.5 text-tiny text-muted-foreground">
            <ProjectDot color={color} className="size-2" />
            <span className="truncate">{event.project.name}</span>
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3 px-3 pb-2 max-[640px]:hidden">
        {event.openTasks.length > 0 && (
          <section className="flex flex-col gap-1">
            <h4 className="text-micro font-semibold text-muted-foreground">
              {k('tasks', { count: event.openTaskCount })}
            </h4>
            <ul className="flex flex-col">
              {event.openTasks.map((task) => (
                <li key={task.id}>
                  <TaskRow groupId={groupId} task={task} today={today} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {event.openTickets.length > 0 && (
          <section className="flex flex-col gap-1">
            <h4 className="text-micro font-semibold text-muted-foreground">
              {k('tickets', { count: event.openTicketCount })}
            </h4>
            <ul className="flex flex-col">
              {event.openTickets.map((ticket) => (
                <li key={ticket.id}>
                  <TicketRow ticket={ticket} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {more && (
          <button
            type="button"
            onClick={onOpen}
            className="w-fit text-tiny font-semibold underline-offset-2 hover:underline"
          >
            {k('showAll', { count: event.openTaskCount + event.openTicketCount })}
          </button>
        )}
        {event.doneCount > 0 && (
          <DonePile groupId={groupId} eventId={event.id} count={event.doneCount} today={today} />
        )}
      </div>
    </li>
  );
}
