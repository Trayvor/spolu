import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIT_CATALOGUE, AUDIT_ENTITY_TYPES } from '@spolu/shared';

/**
 * The coverage guard (spec §12): every action the catalogue names is written somewhere and a
 * test asserts its row. Each entry names the test file (under `src/modules/`) that drives the
 * change and checks the row, or why there is none (`NOT_WRITTEN`). A new catalogue action
 * without a case fails here; a write route that forgets its row fails its module's test.
 */
const COVERED: Record<string, string> = {
  'group.created': 'groups/audit.test.ts',
  'group.updated': 'groups/audit.test.ts',
  'group.invite_regenerated': 'groups/audit.test.ts',
  'group.deactivated': 'groups/audit.test.ts',
  'group.reactivated': 'groups/audit.test.ts',
  'membership.added': 'groups/audit.test.ts',
  'membership.invited': 'groups/audit.test.ts',
  'membership.invite_cancelled': 'groups/audit.test.ts',
  'membership.removed': 'groups/audit.test.ts',
  'membership.restored': 'groups/audit.test.ts',
  'manager.added': 'groups/audit.test.ts',
  'manager.removed': 'groups/audit.test.ts',
  'admin.added': 'users/audit.test.ts',
  'admin.deactivated': 'users/audit.test.ts',
  'finance_access.granted': 'users/audit.test.ts',
  'finance_access.revoked': 'users/audit.test.ts',
  'task.created': 'tasks/audit.test.ts',
  'task.updated': 'tasks/audit.test.ts',
  'task.moved': 'tasks/audit.test.ts',
  'task.completed': 'tasks/audit.test.ts',
  'task.reopened': 'tasks/audit.test.ts',
  'task.deleted': 'tasks/audit.test.ts',
  'bucket.created': 'tasks/audit.test.ts',
  'bucket.renamed': 'tasks/audit.test.ts',
  'bucket.deleted': 'tasks/audit.test.ts',
  'ticket.created': 'tickets/audit.test.ts',
  'ticket.updated': 'tickets/audit.test.ts',
  'ticket.assignee_added': 'tickets/audit.test.ts',
  'ticket.assignee_removed': 'tickets/audit.test.ts',
  'knowledge_item.created': 'knowledge/audit.test.ts',
  'knowledge_item.updated': 'knowledge/audit.test.ts',
  'knowledge_item.deleted': 'knowledge/audit.test.ts',
  'knowledge_item.recording_deleted': 'knowledge/meetings.test.ts',
  'knowledge_folder.created': 'knowledge/audit.test.ts',
  'knowledge_folder.updated': 'knowledge/audit.test.ts',
  'knowledge_folder.deleted': 'knowledge/audit.test.ts',
  'project.created': 'projects/audit.test.ts',
  'project.updated': 'projects/audit.test.ts',
  'project.status_changed': 'projects/audit.test.ts',
  'project.merged': 'projects/audit.test.ts',
  'project.alias_removed': 'projects/audit.test.ts',
  'project.deleted': 'projects/audit.test.ts',
  'project_event.created': 'projects/audit.test.ts',
  'project_event.updated': 'projects/audit.test.ts',
  'project_event.deleted': 'projects/audit.test.ts',
  'finance_item.created': 'finance/audit.test.ts',
  'finance_item.updated': 'finance/audit.test.ts',
  'finance_item.deleted': 'finance/audit.test.ts',
  'finance_folder.created': 'finance/audit.test.ts',
  'finance_folder.updated': 'finance/audit.test.ts',
  'finance_folder.deleted': 'finance/audit.test.ts',
  'time_entry.created': 'finance/audit.test.ts',
  'time_entry.updated': 'finance/audit.test.ts',
  'time_entry.deleted': 'finance/audit.test.ts',
  'rate.created': 'finance/audit.test.ts',
  'rate.deleted': 'finance/audit.test.ts',
  'mcp_token.created': 'mcp/audit-log.test.ts',
  'mcp_token.revoked': 'mcp/audit-log.test.ts',
  'oauth_connection.approved': 'mcp/oauth.test.ts',
  'oauth_connection.revoked': 'mcp/oauth.test.ts',
  'passkey.added': 'auth/passkeys.test.ts',
  'passkey.deleted': 'auth/passkeys.test.ts',
  'bulk_campaign.sent': 'bulk-email/send-routes.test.ts',
  'bulk_campaign.cancelled': 'bulk-email/send-routes.test.ts',
};

/** Catalogue actions with no writer in v1, and why (spec §3.1, plan Task 7). */
const NOT_WRITTEN: Record<string, string> = {
  'admin.renamed': 'no route renames another admin; an own rename is a preference',
  'project.alias_removed':
    'written by removeAlias; covered by the projects routes, no own test yet',
};

const modulesDir = fileURLToPath(new URL('..', import.meta.url));

describe('audit coverage', () => {
  it('every catalogue action has a test case or a reason', () => {
    for (const type of AUDIT_ENTITY_TYPES) {
      for (const action of AUDIT_CATALOGUE[type].actions) {
        const key = `${type}.${action}`;
        expect(COVERED[key] ?? NOT_WRITTEN[key], key).toBeTruthy();
      }
    }
  });

  it("each named test file exists and asserts the action's row", () => {
    for (const [key, file] of Object.entries(COVERED)) {
      const [type, action] = key.split('.') as [string, string];
      const text = readFileSync(`${modulesDir}${file}`, 'utf8');
      expect(
        text.includes(`'${action}'`) || text.includes(`"${action}"`),
        `${key} in ${file}`,
      ).toBe(true);
      expect(text.includes(type) || text.includes('auditRowsOf'), `${key} in ${file}`).toBe(true);
    }
  });
});
