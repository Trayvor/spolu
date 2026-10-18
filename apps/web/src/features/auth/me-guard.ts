import type { Me, MeGroup } from '@spolu/shared';
import type { ResponseParser } from '@/lib/api';

/**
 * A hand-written check of the `/api/me` answer, the same shape as `MeSchema` in `@spolu/shared`.
 * The session query runs on every screen, so it must not import zod (about 26 kB gzip): with
 * this guard the login page and anonymous visitors never download zod. Unknown keys are dropped,
 * as zod's `z.object` does. `me-guard.test.ts` checks it agrees with `MeSchema`.
 */

type Json = Record<string, unknown>;

const ROLES: readonly string[] = ['superadmin', 'admin', 'client'];
const MEMBER_ROLES: readonly string[] = ['client', 'ziadatel'];

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function parseGroup(value: unknown): MeGroup | null {
  if (!isObject(value)) return null;
  const { id, name, role, hasLogo, updatedAt } = value;
  if (!isString(id) || !isString(name) || !isString(updatedAt)) return null;
  if (!isString(role) || !MEMBER_ROLES.includes(role) || typeof hasLogo !== 'boolean') return null;
  return { id, name, role: role as MeGroup['role'], hasLogo, updatedAt };
}

export function parseMe(value: unknown): Me | null {
  if (!isObject(value)) return null;
  const { id, email, name, role, finance, groups } = value;
  if (!isString(id) || !isString(email) || !isString(name)) return null;
  if (!isString(role) || !ROLES.includes(role) || typeof finance !== 'boolean') return null;
  if (!Array.isArray(groups)) return null;
  const parsedGroups: MeGroup[] = [];
  for (const group of groups) {
    const parsed = parseGroup(group);
    if (!parsed) return null;
    parsedGroups.push(parsed);
  }
  return { id, email, name, role: role as Me['role'], finance, groups: parsedGroups };
}

export const meGuard: ResponseParser<Me> = {
  safeParse(data) {
    const me = parseMe(data);
    return me ? { success: true, data: me } : { success: false };
  },
};
