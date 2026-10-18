import type { Db } from '../../infra/db/client.js';
import {
  EmailTakenError,
  findUserByEmail,
  setNameIfEmpty,
  type UserRow,
} from '../users/service.js';
import {
  addMembership,
  getMembership,
  removeMembership,
  restoreMembership,
} from './memberships.js';
import { AlreadyMemberError, inviteMember, MemberRemovedError } from './service.js';

/**
 * The eGrant managers webhook's changes (`docs/integrations/egrant-managers.md`). In eGrant, a
 * manager of an organisation is the client's own person, so these add or remove a **client
 * member** of the client group. They never touch admins, roles or `group_managers`, never
 * re-enable and never disable an account.
 */

export type EgrantClientRefusal = 'email_is_admin' | 'user_disabled';

export type EgrantClientChange =
  | { refused: EgrantClientRefusal }
  | {
      refused?: undefined;
      state: 'created' | 'added' | 'removed' | 'unchanged';
      /** The account after the change; null only when removing an unknown email. */
      account: UserRow | null;
    };

/** Admins and the superadmin are never turned into clients nor changed by eGrant. */
const isStaff = (account: UserRow): boolean => account.role !== 'client';

/**
 * Makes `email` a client member of the group, through the same `inviteMember` as an admin's
 * invite in the app: a missing account is created as an unverified client (with `name`), a
 * requester (ziadatel) membership becomes client, a person may be a client of several groups.
 * A membership removed before (by eGrant or an admin) is restored: eGrant is the source of truth
 * for who its organisation's people are. A disabled account is refused and stays disabled.
 */
export async function addEgrantClient(
  db: Db,
  groupId: string,
  input: { email: string; name: string | null },
): Promise<EgrantClientChange> {
  const before = await findUserByEmail(db, input.email);
  if (before && isStaff(before)) return { refused: 'email_is_admin' };
  if (before?.disabledAt) return { refused: 'user_disabled' };
  const name = input.name ?? '';

  if (before && (await getMembership(db, before.id, groupId))?.removedAt) {
    return restore(db, groupId, before, name);
  }
  try {
    const { member, outcome } = await inviteMember(db, groupId, { email: input.email, name });
    const account = await findUserByEmail(db, member.email);
    if (outcome === 'resent') return { state: 'unchanged', account };
    return { state: before ? 'added' : 'created', account };
  } catch (error) {
    if (error instanceof AlreadyMemberError) return { state: 'unchanged', account: before };
    // An admin created in between: still never a client.
    if (error instanceof EmailTakenError) return { refused: 'email_is_admin' };
    // Removed in between by an admin: restore it like any removed membership.
    if (error instanceof MemberRemovedError && before) return restore(db, groupId, before, name);
    throw error;
  }
}

async function restore(
  db: Db,
  groupId: string,
  account: UserRow,
  name: string,
): Promise<EgrantClientChange> {
  await restoreMembership(db, groupId, account.id);
  // A restored requester membership becomes client.
  await addMembership(db, account.id, groupId, 'client');
  await setNameIfEmpty(db, account.id, name);
  return { state: 'added', account: (await findUserByEmail(db, account.email)) ?? account };
}

/**
 * Removes the person's active **client** membership of this group only. A requester (ziadatel)
 * membership is left alone, so they keep their tickets. The account is never disabled, even with
 * no group left: such a person can still sign in but sees only the tickets they reported.
 */
export async function removeEgrantClient(
  db: Db,
  groupId: string,
  email: string,
): Promise<EgrantClientChange> {
  const account = await findUserByEmail(db, email);
  if (!account) return { state: 'unchanged', account: null };
  if (isStaff(account)) return { refused: 'email_is_admin' };
  const membership = await getMembership(db, account.id, groupId);
  if (!membership || membership.removedAt || membership.role !== 'client') {
    return { state: 'unchanged', account };
  }
  await removeMembership(db, groupId, account.id);
  return { state: 'removed', account };
}
