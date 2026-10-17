import type { ProjectColor } from '@spolu/shared';
import { cn } from '@/lib/utils';

/** The brand accent of each project colour (decision 27); small marks only, never a fill. */
const BG: Record<ProjectColor, string> = {
  purple: 'bg-brand-purple',
  pink: 'bg-brand-pink',
  blue: 'bg-brand-blue',
  coral: 'bg-brand-coral',
  green: 'bg-success',
};

/** A project's colour dot, decorative: the project's name is always next to it. */
export function ProjectDot({ color, className }: { color: ProjectColor; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2.5 shrink-0 rounded-full', BG[color], className)}
    />
  );
}

/** An event's `YYYY-MM-DD` day in the UI language (`4. 11. 2026` in Slovak). */
export function formatEventDate(day: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}
