import { Link } from '@tanstack/react-router';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

/**
 * „História“ in a record's „…“ menu (spec §4.1): opens the audit log filtered to that record.
 * Admins only: the caller renders it only for them. `label` is the record's name for the
 * page's chip; the menu text comes from the detail's own namespace, so the detail never loads
 * the `audit` namespace for it.
 */
export function AuditHistoryItem({
  entityType,
  entityId,
  label,
  text,
}: {
  entityType: string;
  entityId: string;
  label: string;
  text: string;
}) {
  return (
    <DropdownMenuItem asChild>
      <Link to={'/audit' as never} search={{ entityType, entityId, label } as never}>
        {text}
      </Link>
    </DropdownMenuItem>
  );
}

/** The same, as a plain link where a screen has no „…“ menu (the ticket page, a Members tab). */
export function AuditHistoryLink({
  search,
  text,
}: {
  search: { entityType?: string; entityId?: string; group?: string; label?: string };
  text: string;
}) {
  return (
    <Link
      to={'/audit' as never}
      search={search as never}
      className="text-tiny font-semibold underline underline-offset-4 hover:text-neutral"
    >
      {text}
    </Link>
  );
}
