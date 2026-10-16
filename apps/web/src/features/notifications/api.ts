import { queryOptions } from '@tanstack/react-query';
import {
  NotificationFallbackSchema,
  NotificationModesSchema,
  NotificationPrefsSchema,
  type GroupMode,
  type NotificationFallback,
  type NotificationModes,
  type NotificationPrefs,
  type NotificationPrefsPatch,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

export const notificationPrefsQuery = queryOptions({
  queryKey: ['notifications', 'preferences'],
  queryFn: () => apiGet('/notifications/preferences', NotificationPrefsSchema),
});

export function updateNotificationPrefs(patch: NotificationPrefsPatch): Promise<NotificationPrefs> {
  return apiSend('PATCH', '/notifications/preferences', patch, NotificationPrefsSchema);
}

export const notificationModesQuery = queryOptions({
  queryKey: ['notifications', 'modes'],
  queryFn: () => apiGet('/notifications/modes', NotificationModesSchema),
});

export async function setGroupMode(groupId: string, mode: GroupMode): Promise<void> {
  await apiSend('PUT', `/groups/${encodeURIComponent(groupId)}/notification-mode`, { mode });
}

export function setDefaultMode(mode: GroupMode): Promise<NotificationModes> {
  return apiSend('PUT', '/notifications/modes/default', { mode }, NotificationModesSchema);
}

export async function savePushSubscription(json: PushSubscriptionJSON): Promise<void> {
  await apiSend('POST', '/push/subscriptions', json);
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await apiSend('DELETE', '/push/subscriptions', { endpoint });
}

/** iOS without push: switch email on once per user; `turnedOn` says whether this call did it. */
export function requestEmailFallback(): Promise<NotificationFallback> {
  return apiSend('POST', '/me/notification-fallback', {}, NotificationFallbackSchema);
}
