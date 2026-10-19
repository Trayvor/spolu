import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import {
  WeeklySummaryArchiveSchema,
  WeeklySummaryDtoSchema,
  WeeklySummaryGroupOptionSchema,
  WeeklySummaryGroupSettingSchema,
  WeeklySummaryListSchema,
  WeeklySummaryPreviewResultSchema,
  WeeklySummaryRevisionsSchema,
  type UserLanguage,
  type WeeklySummaryContent,
  type WeeklySummaryDto,
} from '@spolu/shared';
import { ApiError, apiGet, apiSend } from '@/lib/api';

/** The weekly summary screens' API (spec 2026-10-19 §7), in their lazy chunk. */

const enc = encodeURIComponent;

export const summaryKeys = {
  all: ['weekly-summaries'] as const,
  list: (week: string | null, scope: string, status: string) =>
    ['weekly-summaries', 'list', week, scope, status] as const,
  detail: (id: string) => ['weekly-summaries', 'detail', id] as const,
  revisions: (id: string) => ['weekly-summaries', 'revisions', id] as const,
  archive: (query: ArchiveFilters) => ['weekly-summaries', 'archive', query] as const,
  setting: (groupId: string) => ['weekly-summaries', 'setting', groupId] as const,
};

export type ListFilters = {
  week?: string;
  scope: 'mine' | 'all';
  status: 'review' | 'sent' | 'all';
};

function search(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
  const text = qs.toString();
  return text ? `?${text}` : '';
}

export const summaryListQuery = (filters: ListFilters) =>
  infiniteQueryOptions({
    queryKey: summaryKeys.list(filters.week ?? null, filters.scope, filters.status),
    queryFn: ({ pageParam }) =>
      apiGet(
        `/weekly-summaries${search({
          week: filters.week,
          scope: filters.scope,
          status: filters.status,
          cursor: pageParam ?? undefined,
        })}`,
        WeeklySummaryListSchema,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

export const summaryQuery = (id: string) =>
  queryOptions({
    queryKey: summaryKeys.detail(id),
    queryFn: () => apiGet(`/weekly-summaries/${enc(id)}`, WeeklySummaryDtoSchema),
  });

export const revisionsQuery = (id: string) =>
  queryOptions({
    queryKey: summaryKeys.revisions(id),
    queryFn: () => apiGet(`/weekly-summaries/${enc(id)}/revisions`, WeeklySummaryRevisionsSchema),
  });

export type ArchiveFilters = {
  groupId?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: 'sent' | 'unsent' | 'all';
};

export const archiveQuery = (filters: ArchiveFilters) =>
  infiniteQueryOptions({
    queryKey: summaryKeys.archive(filters),
    queryFn: ({ pageParam }) =>
      apiGet(
        `/weekly-summaries/archive${search({ ...filters, cursor: pageParam ?? undefined })}`,
        WeeklySummaryArchiveSchema,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

const GroupOptionsSchema = z.object({ items: z.array(WeeklySummaryGroupOptionSchema) });
export const groupOptionsQuery = (q: string) =>
  queryOptions({
    queryKey: ['weekly-summaries', 'groups', q] as const,
    queryFn: () => apiGet(`/weekly-summaries/groups${search({ q })}`, GroupOptionsSchema),
    staleTime: 60_000,
  });

export const groupSettingQuery = (groupId: string) =>
  queryOptions({
    queryKey: summaryKeys.setting(groupId),
    queryFn: () =>
      apiGet(`/groups/${enc(groupId)}/weekly-summary/settings`, WeeklySummaryGroupSettingSchema),
  });

const ReminderSchema = z.object({ remind: z.boolean() });
export const reminderQuery = queryOptions({
  queryKey: ['weekly-summaries', 'reminder'] as const,
  queryFn: () => apiGet('/me/weekly-summary/reminder', ReminderSchema),
});

export const saveSummary = (
  id: string,
  body: { version: number; content: WeeklySummaryContent; language?: UserLanguage },
) => apiSend('PATCH', `/weekly-summaries/${enc(id)}`, body, WeeklySummaryDtoSchema);

export const regenerateSummary = (id: string, body: { version: number; language?: UserLanguage }) =>
  apiSend('POST', `/weekly-summaries/${enc(id)}/regenerate`, body);

export const restoreRevision = (id: string, revisionId: string, version: number) =>
  apiSend(
    'POST',
    `/weekly-summaries/${enc(id)}/revisions/${enc(revisionId)}/restore`,
    { version },
    WeeklySummaryDtoSchema,
  );

export const previewSummary = (id: string, language: UserLanguage) =>
  apiSend(
    'POST',
    `/weekly-summaries/${enc(id)}/preview`,
    { language },
    WeeklySummaryPreviewResultSchema,
  );

export const testSummary = (id: string) => apiSend('POST', `/weekly-summaries/${enc(id)}/test`);

const SendResultSchema = z.object({ recipients: z.number().int() });
export const sendSummary = (id: string, version: number) =>
  apiSend('POST', `/weekly-summaries/${enc(id)}/send`, { version }, SendResultSchema);

export const skipSummary = (id: string, version: number) =>
  apiSend('POST', `/weekly-summaries/${enc(id)}/skip`, { version }, WeeklySummaryDtoSchema);

export const setGroupSetting = (groupId: string, enabled: boolean) =>
  apiSend('PUT', `/groups/${enc(groupId)}/weekly-summary/settings`, { enabled });

export const setReminder = (remind: boolean) =>
  apiSend('PUT', '/me/weekly-summary/reminder', { remind });

/** The current DTO of a 409 `stale_version` or `refs_changed` answer, or null. */
export function conflictOf(
  error: unknown,
): { code: 'stale_version' | 'refs_changed'; current: WeeklySummaryDto } | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const code = error.code;
  if (code !== 'stale_version' && code !== 'refs_changed') return null;
  const parsed = WeeklySummaryDtoSchema.safeParse((error.body as { current?: unknown }).current);
  return parsed.success ? { code, current: parsed.data } : null;
}
