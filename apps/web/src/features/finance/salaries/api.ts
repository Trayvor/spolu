import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  SalaryDetailSchema,
  SalaryPageSchema,
  type SalaryBody,
  type SalaryDetail,
  type SalaryPatch,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';
import type { MonthRange } from '../period';

/**
 * Salaries ("Mzdy", 2026-10-21) on `/finance`. Every key starts with `['finance', 'all', …]`,
 * so the page's `finance:changed` (a salary write has no client) and its own writes refetch them.
 */

const enc = encodeURIComponent;

export const SALARIES_KEY = ['finance', 'all', 'salaries'] as const;

/** The Mzdy view's list: one admin (null: every admin) in the page period (null: all time). */
export const salariesQuery = (admin: string | null, range: MonthRange | null) =>
  infiniteQueryOptions({
    queryKey: [...SALARIES_KEY, 'list', admin, range?.from ?? null, range?.to ?? null],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (admin) params.set('admin', admin);
      if (range) {
        params.set('from', range.from);
        params.set('to', range.to);
      }
      if (pageParam) params.set('after', pageParam);
      const query = params.size > 0 ? `?${params}` : '';
      return apiGet(`/finance/salaries${query}`, SalaryPageSchema);
    },
    getNextPageParam: (page) => page.nextCursor,
  });

export const salaryQuery = (id: string) =>
  queryOptions({
    queryKey: [...SALARIES_KEY, 'one', id],
    queryFn: () => apiGet(`/finance/salaries/${enc(id)}`, SalaryDetailSchema),
  });

export function createSalary(body: SalaryBody): Promise<SalaryDetail> {
  return apiSend('POST', '/finance/salaries', body, SalaryDetailSchema);
}

export function updateSalary(id: string, patch: SalaryPatch): Promise<SalaryDetail> {
  return apiSend('PATCH', `/finance/salaries/${enc(id)}`, patch, SalaryDetailSchema);
}

export async function deleteSalary(id: string): Promise<void> {
  await apiSend('DELETE', `/finance/salaries/${enc(id)}`);
}

/** What a document is linked to: a salary or an expense. */
export type CostTarget = { kind: 'salary' | 'expense'; id: string };

const linksPath = (target: CostTarget) =>
  `/finance/${target.kind === 'salary' ? 'salaries' : 'expenses'}/${enc(target.id)}/documents`;

export async function linkDocument(target: CostTarget, documentId: string): Promise<void> {
  await apiSend('POST', linksPath(target), { documentId });
}

export async function unlinkDocument(target: CostTarget, documentId: string): Promise<void> {
  await apiSend('DELETE', `${linksPath(target)}/${enc(documentId)}`);
}

/** "september 2026" in the UI language. */
export function formatMonth(month: string, language: string): string {
  const at = new Date(`${month}-01T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return month;
  return at.toLocaleDateString(/^en\b/.test(language) ? 'en-GB' : language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
