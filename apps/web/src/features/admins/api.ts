import { queryOptions } from '@tanstack/react-query';
import {
  AdminListSchema,
  AdminSchema,
  SubstitutionSchema,
  type AddAdminBody,
  type Admin,
  type SetSubstitutionBody,
  type Substitution,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/** Active admins, superadmin first (the server sorts). */
export const adminsQuery = queryOptions({
  queryKey: ['admins'],
  queryFn: () => apiGet('/admins', AdminListSchema),
});

export async function addAdmin(body: AddAdminBody): Promise<Admin> {
  return apiSend('POST', '/admins', body, AdminSchema);
}

export async function removeAdmin(id: string): Promise<void> {
  await apiSend('DELETE', `/admins/${encodeURIComponent(id)}`);
}

/** The superadmin's Finance switch (Phase 32): grants (`on`) or removes the finance right. */
export async function setFinanceAccess(id: string, on: boolean): Promise<void> {
  await apiSend(on ? 'PUT' : 'DELETE', `/admins/${encodeURIComponent(id)}/finance-access`);
}

/** Starts "body.substituteId substitutes admin `id`" (2026-10-19, ADR 0059). */
export async function setSubstitution(
  id: string,
  body: SetSubstitutionBody,
): Promise<Substitution> {
  return apiSend('PUT', `/admins/${encodeURIComponent(id)}/substitution`, body, SubstitutionSchema);
}

/** Ends admin `id`'s substitution ("Ukončiť zastupovanie"); idempotent. */
export async function endSubstitution(id: string): Promise<void> {
  await apiSend('DELETE', `/admins/${encodeURIComponent(id)}/substitution`);
}
