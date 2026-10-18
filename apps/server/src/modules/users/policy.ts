import type { Role, SessionUser } from '@spolu/shared';

export function isAdmin(actor: SessionUser): boolean {
  return actor.role === 'superadmin' || actor.role === 'admin';
}

/** Any admin creates and removes admins. */
export function canManageAdmins(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/**
 * The global search's people (2026-10-18): admins only. A client sees people only inside their
 * groups (the members tab, mentions), never a directory across clients.
 */
export function canSearchPeople(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/** Only admins can be removed: never the superadmin, never yourself. */
export function canDeactivate(actor: SessionUser, target: { id: string; role: Role }): boolean {
  return canManageAdmins(actor) && target.role === 'admin' && target.id !== actor.id;
}
