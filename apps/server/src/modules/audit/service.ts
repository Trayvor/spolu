import { randomUUID } from 'node:crypto';
import {
  AUDIT_LIMITS,
  auditCategoryOf,
  isAuditAction,
  type AuditAction,
  type AuditChanges,
  type AuditEntityType,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { AuditActor } from './actor.js';
import { cut } from './diff.js';
import { auditLog } from './schema.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** One changed record (spec §3). `causeId`: the row this one is a consequence of. */
export type AuditEntry = {
  entityType: AuditEntityType;
  entityId: string;
  entityLabel: string;
  groupId: string | null;
  action: AuditAction;
  changes?: AuditChanges;
  causeId?: string | null;
};

export class InvalidAuditActionError extends Error {
  constructor(type: string, action: string) {
    super(`${action} is not an action of ${type}`);
    this.name = 'InvalidAuditActionError';
  }
}

function actorColumns(by: AuditActor) {
  switch (by.kind) {
    case 'user':
      return {
        actorKind: by.kind,
        actorUserId: by.userId,
        actorTokenId: null,
        actorLabel: by.name,
        actorDetail: null,
      };
    case 'mcp':
      return {
        actorKind: by.kind,
        actorUserId: by.userId,
        actorTokenId: by.tokenId,
        actorLabel: by.name,
        actorDetail: by.tokenName,
      };
    case 'egrant':
      return {
        actorKind: by.kind,
        actorUserId: null,
        actorTokenId: null,
        actorLabel: by.instance,
        actorDetail: by.source,
      };
    case 'system':
      return {
        actorKind: by.kind,
        actorUserId: null,
        actorTokenId: null,
        actorLabel: by.job,
        actorDetail: null,
      };
  }
}

const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

/** The diff, cut to 8 kB: the first fields are kept, then `_truncated` (spec §3.2). */
export function boundChanges(changes: AuditChanges): AuditChanges {
  if (bytes(changes) <= AUDIT_LIMITS.changesBytes) return changes;
  const kept: AuditChanges = { _truncated: true };
  for (const [field, change] of Object.entries(changes)) {
    if (field === '_truncated') continue;
    const next = { ...kept, [field]: change };
    if (bytes(next) > AUDIT_LIMITS.changesBytes) break;
    kept[field] = change;
  }
  return kept;
}

/**
 * Inserts the rows in one statement on `tx`, the transaction of the change itself (spec §12):
 * a failed insert rolls the change back. Returns the new rows' ids in order (for `causeId`).
 * An empty list sends nothing. Throws on an action that is not of its entity type.
 */
export async function recordAudit(
  tx: Tx | Db,
  by: AuditActor,
  entries: AuditEntry[],
): Promise<string[]> {
  if (entries.length === 0) return [];
  const actor = actorColumns(by);
  const now = new Date();
  const values = entries.map((entry) => {
    if (!isAuditAction(entry.entityType, entry.action)) {
      throw new InvalidAuditActionError(entry.entityType, entry.action);
    }
    return {
      id: randomUUID(),
      createdAt: now,
      ...actor,
      actorLabel: cut(actor.actorLabel, AUDIT_LIMITS.labelChars),
      actorDetail:
        actor.actorDetail === null ? null : cut(actor.actorDetail, AUDIT_LIMITS.labelChars),
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityLabel: cut(entry.entityLabel, AUDIT_LIMITS.labelChars),
      groupId: entry.groupId,
      category: auditCategoryOf(entry.entityType),
      action: entry.action,
      changes: boundChanges(entry.changes ?? {}),
      causeId: entry.causeId ?? null,
    };
  });
  await tx.insert(auditLog).values(values);
  return values.map((v) => v.id);
}
