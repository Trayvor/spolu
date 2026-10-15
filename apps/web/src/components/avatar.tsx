import { cn } from '@/lib/utils';

const COLORS = [
  'bg-brand-purple',
  'bg-brand-pink',
  'bg-brand-blue',
  'bg-brand-coral',
  'bg-success',
] as const;

/** A stable background class for a user id (32-bit FNV-1a hash, five accents). */
export function avatarColor(userId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return COLORS[(hash >>> 0) % COLORS.length]!;
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
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        avatarColor(userId),
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initialsOf(name)}
    </span>
  );
}
