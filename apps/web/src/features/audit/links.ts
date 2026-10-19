import type { AuditEntryDto } from '@spolu/shared';

/** Where a row's label leads while its record exists (spec §4.2): a route with its params. */
export type AuditLink = {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
};

export function recordLink(entry: AuditEntryDto): AuditLink | null {
  if (!entry.linkable) return null;
  const groupId = entry.group?.id;
  const id = entry.entityId;
  const inGroup = (to: string, search?: Record<string, string>): AuditLink | null =>
    groupId ? { to, params: { groupId }, ...(search ? { search } : {}) } : null;
  switch (entry.entityType) {
    case 'task':
      return groupId
        ? { to: '/groups/$groupId/tasks/$taskId', params: { groupId, taskId: id } }
        : null;
    case 'bucket':
      return inGroup('/groups/$groupId/tasks');
    case 'ticket':
      return { to: '/tickets/$ticketId', params: { ticketId: id } };
    case 'knowledge_item':
      return inGroup('/groups/$groupId/knowledge', { k: id });
    case 'knowledge_folder':
      return inGroup('/groups/$groupId/knowledge', { folder: id });
    case 'project':
      return inGroup('/groups/$groupId/overview', { sheet: id });
    case 'project_event':
      return inGroup('/groups/$groupId/overview', { event: id });
    case 'group':
      return { to: '/groups/$groupId', params: { groupId: id } };
    case 'membership':
    case 'manager':
      return inGroup('/groups/$groupId/members');
    case 'admin':
      return { to: '/admins' };
    case 'finance_item':
      return groupId
        ? inGroup('/groups/$groupId/finance')
        : { to: '/finance', search: { item: id } };
    case 'finance_folder':
    case 'time_entry':
      return groupId ? inGroup('/groups/$groupId/finance') : { to: '/finance' };
    case 'bulk_campaign':
      return { to: '/bulk-email/$campaignId', params: { campaignId: id } };
    default:
      return null;
  }
}
