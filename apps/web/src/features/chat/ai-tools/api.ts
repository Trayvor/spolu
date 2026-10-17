import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  AiTextResultSchema,
  AiToolsInfoSchema,
  type AiTextBody,
  type AiToolsInfo,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/**
 * Which composer tools a channel offers its reader (Phase 28). It changes only with the server's
 * configuration, the group's eGrant link or its clients, so it is read once per channel and
 * session. The AI button and the microphone share this one query.
 */
export const aiToolsQuery = (channelId: string) =>
  queryOptions({
    queryKey: ['chat', 'ai-tools', channelId],
    queryFn: () => apiGet(`/channels/${encodeURIComponent(channelId)}/ai-tools`, AiToolsInfoSchema),
    staleTime: Infinity,
    retry: false,
  });

/** The channel's tools; undefined while loading or when the call failed (the buttons hide). */
export function useAiTools(channelId: string): AiToolsInfo | undefined {
  return useQuery(aiToolsQuery(channelId)).data;
}

/** Rewrites the draft on the server: only the text and the action leave the browser. */
export async function rewriteText(channelId: string, body: AiTextBody): Promise<string> {
  const result = await apiSend(
    'POST',
    `/channels/${encodeURIComponent(channelId)}/ai-text`,
    body,
    AiTextResultSchema,
  );
  return result.text;
}
