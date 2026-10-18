import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Phase 34 decision 11: the mark of an item that comes from the admin group "eGrant tím": the
 * egrant mark and the name, the same on cards, pickers, the global list and the read-only view.
 * `label` comes from the caller's namespace (`chat` or `knowledge`).
 */
export function AdminGroupBadge({ label, className }: { label: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('shrink-0', className)} data-admin-group-badge="">
      <img src="/brand/favicon.svg" alt="" width={12} height={12} decoding="async" />
      {label}
    </Badge>
  );
}
