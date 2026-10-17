import { queryOptions } from '@tanstack/react-query';
import { AdminListSchema, AdminSchema, type AddAdminBody, type Admin } from '@spolu/shared';
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
