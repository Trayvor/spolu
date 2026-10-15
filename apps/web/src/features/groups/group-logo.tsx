import { cn } from '@/lib/utils';

interface GroupLogoProps {
  /** A group the viewer can read: `/api/groups/:id/logo`. */
  groupId?: string;
  /** An invite token (public join page): `/api/join/:token/logo`. */
  token?: string;
  name: string;
  hasLogo: boolean;
  /** The group's `updatedAt`: a changed logo gets a new URL, so the 24 h browser cache never serves the old one. */
  version?: string;
  /** Square side in px. */
  size?: number;
  className?: string;
}

/** The group's logo, or its first letter on a `bg-secondary` tile. Decorative: the name sits next to it. */
export function GroupLogo({
  groupId,
  token,
  name,
  hasLogo,
  version,
  size = 40,
  className,
}: GroupLogoProps) {
  const src = token
    ? `/api/join/${encodeURIComponent(token)}/logo`
    : groupId
      ? `/api/groups/${encodeURIComponent(groupId)}/logo?v=${encodeURIComponent(version ?? '')}`
      : undefined;
  const box = cn('shrink-0 rounded-lg', className);
  if (hasLogo && src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={cn(box, 'object-contain')}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        box,
        'inline-flex items-center justify-center bg-secondary font-semibold text-secondary-foreground',
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {(Array.from(name.trim())[0] ?? '').toUpperCase()}
    </span>
  );
}
