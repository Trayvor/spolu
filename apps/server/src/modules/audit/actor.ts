import type { AuditEgrantSource } from '@spolu/shared';

/**
 * The author of a change (spec §2), passed explicitly to every audited service function
 * (ADR 0054): a person in the app, a person through an MCP token or OAuth connection, eGrant
 * (a webhook, with the instance's origin) or the system (a job, with its name).
 */
export type AuditActor =
  | { kind: 'user'; userId: string; name: string }
  | { kind: 'mcp'; userId: string; name: string; tokenId: string; tokenName: string }
  | { kind: 'egrant'; source: AuditEgrantSource; instance: string }
  | { kind: 'system'; job: string };

export function userActor(user: { id: string; name: string }): AuditActor {
  return { kind: 'user', userId: user.id, name: user.name };
}

export function egrantActor(source: AuditEgrantSource, instance: string): AuditActor {
  return { kind: 'egrant', source, instance };
}

export function systemActor(job: string): AuditActor {
  return { kind: 'system', job };
}

/** The person behind an actor (a user or an MCP call), or null for eGrant and the system. */
export function actorUserId(by: AuditActor): string | null {
  return by.kind === 'user' || by.kind === 'mcp' ? by.userId : null;
}
