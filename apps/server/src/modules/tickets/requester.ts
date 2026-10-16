import type { Db } from '../../infra/db/client.js';
import { isUniqueViolation } from '../../infra/db/errors.js';
import { addMembership, getMembership } from '../groups/memberships.js';
import {
  createRequesterAccount,
  findUserByEmail,
  findUserByMailbox,
  normalizeEmail,
  type UserRow,
} from '../users/service.js';

/** The initiator's account (null: only the name and email are kept) and whether to email them. */
export type ResolvedRequester = { userId: string | null; notify: boolean };

const nobody: ResolvedRequester = { userId: null, notify: false };

/**
 * Who started a ticket of `groupId`, by the email it carries (spec §3 step 2): an admin stays an
 * admin; a client of the group stays theirs; anyone else (a client of another group, a new
 * person) gets a ziadatel membership of the group, and a new person a client account first. An
 * existing account is found by the exact address, else by its mailbox (`findUserByMailbox`). A
 * membership an admin removed, a disabled account or no email links no account.
 */
export async function resolveRequester(
  db: Db,
  groupId: string,
  email: string | null,
  name: string | null,
): Promise<ResolvedRequester> {
  if (email === null || email.trim() === '') return nobody;
  const account = await findOrCreate(db, normalizeEmail(email), name);
  if (account.disabledAt) return nobody;
  if (account.role !== 'client') return { userId: account.id, notify: true };
  const membership = await getMembership(db, account.id, groupId);
  if (membership?.removedAt) return nobody;
  if (!membership && (await addMembership(db, account.id, groupId, 'ziadatel')) === 'removed') {
    return nobody;
  }
  return { userId: account.id, notify: true };
}

async function findOrCreate(db: Db, email: string, name: string | null): Promise<UserRow> {
  // The same mailbox under another spelling (a Gmail address with dots, a +tag) is the same
  // person: never a second account beside, say, an admin's.
  const existing = (await findUserByEmail(db, email)) ?? (await findUserByMailbox(db, email));
  if (existing) return existing;
  try {
    return await createRequesterAccount(db, { email, name });
  } catch (error) {
    // A concurrent ticket with the same email created it first.
    if (!isUniqueViolation(error)) throw error;
    const winner = await findUserByEmail(db, email);
    if (!winner) throw error;
    return winner;
  }
}
