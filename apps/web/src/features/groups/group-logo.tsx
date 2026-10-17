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
  /** The admin group "eGrant tím" (Phase 34): without its own logo it shows the egrant mark. */
  admin?: boolean;
  className?: string;
}

/**
 * The group's logo, or its first letter on a `bg-secondary` tile (the admin group: the egrant
 * mark). Decorative: the name sits next to it.
 */
export function GroupLogo({
  groupId,
  token,
  name,
  hasLogo,
  version,
  size = 40,
  className,
  admin = false,
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
  if (admin) {
    return (
      <span
        aria-hidden="true"
        data-egrant-mark=""
        className={cn(box, 'inline-flex items-center justify-center bg-secondary')}
        style={{ width: size, height: size }}
      >
        <img
          src="/brand/favicon.svg"
          alt=""
          width={Math.round(size * 0.6)}
          height={Math.round(size * 0.6)}
          decoding="async"
        />
      </span>
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
