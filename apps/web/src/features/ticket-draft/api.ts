import { TicketDraftSchema, type TicketDraft } from '@spolu/shared';
import { i18n } from '@/i18n';
import { ApiError } from '@/lib/api';

/**
 * "Navrhnúť odpoveď": `POST /api/tickets/:id/ai-draft`. Its own fetch (not `apiSend`) for the
 * `signal`: closing the dialog aborts the request. A non-2xx answer rejects with ApiError.
 */
export async function postTicketDraft(
  ticketId: string,
  instructions: string,
  signal: AbortSignal,
): Promise<TicketDraft> {
  const path = `/tickets/${encodeURIComponent(ticketId)}/ai-draft`;
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Accept-Language': i18n.language,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ instructions }),
    signal,
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new ApiError(`POST ${path} failed (HTTP ${res.status})`, res.status, data);
  const parsed = TicketDraftSchema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(`Response from ${path} does not match the expected shape`, res.status, data);
  }
  return parsed.data;
}
