import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  AiTextResultSchema,
  AiToolsInfoSchema,
  type AiTextBody,
  type AiToolsInfo,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/**
 * Where the AI tools and the microphone send their calls: a chat channel (the composer) or a
 * group (a description field, Phase 33 part P5). Same tools, limits and answers.
 */
export type AiTarget = { kind: 'channel' | 'group'; id: string };

/** The target's base path: `/channels/:id` or `/groups/:id`. */
export const aiPath = (target: AiTarget) =>
  `/${target.kind === 'channel' ? 'channels' : 'groups'}/${encodeURIComponent(target.id)}`;

/**
 * Which tools a channel or group offers its reader (Phase 28). It changes only with the server's
 * configuration, the group's eGrant link or its clients, so it is read once per target and
 * session. The AI button and the microphone share this one query.
 */
export const aiToolsQuery = (target: AiTarget) =>
  queryOptions({
    queryKey: ['chat', 'ai-tools', target.kind, target.id],
    queryFn: () => apiGet(`${aiPath(target)}/ai-tools`, AiToolsInfoSchema),
    staleTime: Infinity,
    retry: false,
  });

/** The target's tools; undefined while loading or when the call failed (the buttons hide). */
export function useAiTools(target: AiTarget): AiToolsInfo | undefined {
  return useQuery(aiToolsQuery(target)).data;
}

/** Rewrites the draft on the server: only the text and the action leave the browser. */
export async function rewriteText(target: AiTarget, body: AiTextBody): Promise<string> {
  const result = await apiSend('POST', `${aiPath(target)}/ai-text`, body, AiTextResultSchema);
  return result.text;
}
