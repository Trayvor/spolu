import type { EventRefDto, ProjectRefDto } from '@spolu/shared';
import { cn } from '@/lib/utils';
import { ProjectDot } from './project-dot';

/**
 * The small project mark of task cards and ticket rows (Phase 33 part P2, spec §6): the project's
 * colour dot and name, and ", event" when set, on one truncated line. A žiadateľ's ref has no
 * colour: then the name stands alone.
 */
export function ProjectChip({
  project,
  event,
  className,
}: {
  project: ProjectRefDto;
  event?: EventRefDto | null;
  className?: string;
}) {
  const text = event ? `${project.name}, ${event.name}` : project.name;
  return (
    <span
      title={text}
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 text-micro text-muted-foreground',
        className,
      )}
    >
      {project.color && <ProjectDot color={project.color} className="size-2" />}
      <span className="truncate">{text}</span>
    </span>
  );
}
