import { cn } from '@/lib/utils';

/**
 * Background and initials colour, each pair at least 4.5:1 (WCAG AA): white on the dark
 * accents (purple 4.7, blue 7.1, success 5.5), ink on the light ones (pink 6.2, coral 7.9).
 */
const COLORS = [
  { bg: 'bg-brand-purple', text: 'text-white' },
  { bg: 'bg-brand-pink', text: 'text-foreground' },
  { bg: 'bg-brand-blue', text: 'text-white' },
  { bg: 'bg-brand-coral', text: 'text-foreground' },
  { bg: 'bg-success', text: 'text-white' },
] as const;

/** A stable background class for a user id (32-bit FNV-1a hash, five accents). */
function pick(userId: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return COLORS[(hash >>> 0) % COLORS.length]!;
}

/** A stable `bg-*` class for a user id. */
export function avatarColor(userId: string): string {
  return pick(userId).bg;
}

/** The initials colour class that reads on `avatarColor(userId)` (AA contrast). */
export function avatarTextColor(userId: string): string {
  return pick(userId).text;
}

/** First letter of the first and the last word, upper-cased; `?` for an empty name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0]!)[0]!;
  const last = words.length > 1 ? Array.from(words[words.length - 1]!)[0]! : '';
  return (first + last).toUpperCase();
}

/** A round initials badge. Decorative: the name is always shown next to it. */
export function Avatar({
  userId,
  name,
  size = 32,
  className,
}: {
  userId: string;
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        avatarColor(userId),
        avatarTextColor(userId),
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4) }}
    >
      {initialsOf(name)}
    </span>
  );
}
