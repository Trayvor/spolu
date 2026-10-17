import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import {
  BulkAudienceSchema,
  BulkBlockSchema,
  BulkCampaignStatusSchema,
  BulkRecipientStatusSchema,
  type BulkAudience,
  type BulkAudienceCount,
  type BulkAudiencePage,
  type BulkBlock,
  type BulkCampaignDraft,
  type BulkCampaignDto,
  type BulkCampaignListItem,
  type BulkCampaignPage,
  type BulkPerson,
  type BulkRecipientPage,
  type BulkRecipientStatus,
  type BulkSenderDto,
} from '@spolu/shared';
import { i18n } from '@/i18n';
import { ApiError, apiGet, apiSend } from '@/lib/api';

const enc = encodeURIComponent;

// The bulk email DTOs are TypeScript types in @spolu/shared; these schemas check the answers
// here, in the lazy chunk, so nothing of them reaches the entry chunk.
const count = z.number().int();
const CountsSchema = z.object({
  queued: count,
  sending: count,
  sent: count,
  failed: count,
  skipped: count,
  cancelled: count,
  unsubscribed: count,
});
const ListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  status: BulkCampaignStatusSchema,
  recipientCount: count.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sendStartedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  counts: CountsSchema,
  createdByName: z.string().nullable(),
  sentByName: z.string().nullable(),
}) satisfies z.ZodType<BulkCampaignListItem>;
const CampaignSchema = ListItemSchema.extend({
  preheader: z.string(),
  blocks: z.array(BulkBlockSchema),
  phoneBlocks: z.array(BulkBlockSchema).nullable(),
  phoneCheckShown: z.boolean(),
  audience: BulkAudienceSchema,
  version: count,
  sender: z.string().nullable(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
  sentBy: z.string().nullable(),
}) satisfies z.ZodType<BulkCampaignDto>;
const PageSchema = z.object({
  items: z.array(ListItemSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<BulkCampaignPage>;
const PersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['client', 'ziadatel', 'admin']),
  groups: z.array(z.string()),
}) satisfies z.ZodType<BulkPerson>;
const PeopleSchema = z.array(PersonSchema);
const AudiencePageSchema = z.object({
  items: PeopleSchema,
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<BulkAudiencePage>;
const AudienceCountSchema = z.object({
  count,
  leftOut: z.object({ unsubscribed: count, disabled: count }),
}) satisfies z.ZodType<BulkAudienceCount>;
const RecipientPageSchema = z.object({
  items: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      email: z.string(),
      status: BulkRecipientStatusSchema,
      error: z.string().nullable(),
      sentAt: z.string().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<BulkRecipientPage>;
const SenderSchema = z.object({ sender: z.string() }) satisfies z.ZodType<BulkSenderDto>;
const PreviewSchema = z.object({ html: z.string() });
const ImageSchema = z.object({ id: z.string(), url: z.string(), width: count, height: count });

/** Every bulk email query starts with this key: one invalidation refreshes them all. */
export const BULK_KEY = ['bulk-email'] as const;
export const campaignListKey = [...BULK_KEY, 'campaigns'] as const;

/** The campaign list, last changed first, 50 a page. */
export const campaignsQuery = infiniteQueryOptions({
  queryKey: campaignListKey,
  initialPageParam: null as string | null,
  queryFn: ({ pageParam }) =>
    apiGet(`/bulk-email/campaigns${pageParam ? `?cursor=${enc(pageParam)}` : ''}`, PageSchema),
  getNextPageParam: (last) => last.nextCursor,
});

export const campaignQuery = (id: string) =>
  queryOptions({
    queryKey: [...BULK_KEY, 'campaign', id],
    queryFn: async () => {
      // apiGet parses any status: a 404 must stay an error the page can show.
      const res = await apiGet(
        `/bulk-email/campaigns/${enc(id)}`,
        z.union([CampaignSchema, z.object({ error: z.string() })]),
      );
      if ('error' in res) {
        const status = res.error === 'not_found' ? 404 : 500;
        throw new ApiError(`Campaign ${id}: ${res.error}`, status, res);
      }
      return res;
    },
  });

export function createCampaign(name: string): Promise<BulkCampaignDto> {
  return apiSend('POST', '/bulk-email/campaigns', { name }, CampaignSchema);
}

export function saveCampaign(id: string, draft: BulkCampaignDraft): Promise<BulkCampaignDto> {
  return apiSend('PUT', `/bulk-email/campaigns/${enc(id)}`, draft, CampaignSchema);
}

export async function deleteCampaign(id: string): Promise<void> {
  await apiSend('DELETE', `/bulk-email/campaigns/${enc(id)}`);
}

export function duplicateCampaign(id: string): Promise<BulkCampaignDto> {
  return apiSend('POST', `/bulk-email/campaigns/${enc(id)}/duplicate`, undefined, CampaignSchema);
}

export async function previewCampaign(
  id: string,
  content: {
    subject: string;
    preheader: string;
    blocks: BulkBlock[];
    phoneBlocks: BulkBlock[] | null;
  },
): Promise<string> {
  return (await apiSend('POST', `/bulk-email/campaigns/${enc(id)}/preview`, content, PreviewSchema))
    .html;
}

/** Remembers that the one-time "check the phone version" warning was shown (Phase 31). */
export async function markPhoneCheckShown(id: string): Promise<void> {
  await apiSend('POST', `/bulk-email/campaigns/${enc(id)}/phone-check`);
}

/** Test send to the signed-in admin only (route of part 23.5). */
export async function sendTest(id: string): Promise<void> {
  await apiSend('POST', `/bulk-email/campaigns/${enc(id)}/test`);
}

/** Start sending (part 23.5): answers the campaign, now `sending` (or already `sent`). */
export function sendCampaign(id: string): Promise<BulkCampaignDto> {
  return apiSend('POST', `/bulk-email/campaigns/${enc(id)}/send`, undefined, CampaignSchema);
}

/** Stop a campaign that is sending; `409 not_sending` once it finished. */
export function cancelCampaign(id: string): Promise<BulkCampaignDto> {
  return apiSend('POST', `/bulk-email/campaigns/${enc(id)}/cancel`, undefined, CampaignSchema);
}

/** The From address bulk email goes out with, for the send dialog. */
export const senderQuery = queryOptions({
  queryKey: [...BULK_KEY, 'sender'],
  queryFn: async () => (await apiGet('/bulk-email/sender', SenderSchema)).sender,
  staleTime: Infinity,
});

/**
 * The per-person report list, by name, 50 a page. The key starts with the campaign's key, so
 * `bulk:updated` (which invalidates the campaign) refreshes it too.
 */
export const recipientsQuery = (id: string, status: BulkRecipientStatus | null) =>
  infiniteQueryOptions({
    queryKey: [...campaignQuery(id).queryKey, 'recipients', status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (pageParam) params.set('cursor', pageParam);
      const search = params.size ? `?${params.toString()}` : '';
      return apiGet(`/bulk-email/campaigns/${enc(id)}/recipients${search}`, RecipientPageSchema);
    },
    getNextPageParam: (last) => last.nextCursor,
  });

export const audienceCountQuery = (audience: BulkAudience) =>
  queryOptions({
    queryKey: [...BULK_KEY, 'audience-count', audience],
    queryFn: () => apiSend('POST', '/bulk-email/audience/count', audience, AudienceCountSchema),
  });

export const audiencePeopleQuery = (audience: BulkAudience) =>
  infiniteQueryOptions({
    queryKey: [...BULK_KEY, 'audience-people', audience],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiSend(
        'POST',
        `/bulk-email/audience/people${pageParam ? `?cursor=${enc(pageParam)}` : ''}`,
        audience,
        AudiencePageSchema,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

export const peopleSearchQuery = (q: string) =>
  queryOptions({
    queryKey: [...BULK_KEY, 'people', q],
    queryFn: () => apiGet(`/bulk-email/people?q=${enc(q)}`, PeopleSchema),
  });

/** The people behind saved ids (hand-picked people of a draft), by id. */
export const peopleLookupQuery = (ids: string[]) =>
  queryOptions({
    queryKey: [...BULK_KEY, 'lookup', ids],
    queryFn: () => apiSend('POST', '/bulk-email/people/lookup', { ids }, PeopleSchema),
  });

/** Upload an already shrunk PNG or JPEG; answers its id, public URL and size. */
export async function uploadImage(blob: Blob): Promise<z.infer<typeof ImageSchema>> {
  const res = await fetch('/api/bulk-email/images', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Accept-Language': i18n.language,
      'Content-Type': blob.type,
    },
    body: blob,
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new ApiError(`Image upload failed (HTTP ${res.status})`, res.status, data);
  const parsed = ImageSchema.safeParse(data);
  if (!parsed.success) throw new ApiError('Image upload answer is malformed', res.status, data);
  return parsed.data;
}
