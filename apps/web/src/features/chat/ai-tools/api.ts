import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  AiTextResultSchema,
  AiToolsInfoSchema,
  type AiTextBody,
  type AiToolsInfo,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/**
 * Where the AI tools and the microphone send their calls: a chat channel (the composer), a
 * group (a description field, Phase 33 part P5) or, for admins' fields that belong to no client
 * group (the bulk email builder), the admin scope. Same tools, limits and answers.
 */
export type AiTarget =
  { kind: 'channel' | 'group'; id: string } | { kind: 'admin'; id?: undefined };

/** Admins' fields without a client group (`/ai/admin/…`, admins only). */
export const ADMIN_AI_TARGET: AiTarget = { kind: 'admin' };

/** The target's base path: `/channels/:id`, `/groups/:id` or `/ai/admin`. */
export const aiPath = (target: AiTarget) =>
  target.kind === 'admin'
    ? '/ai/admin'
    : `/${target.kind === 'channel' ? 'channels' : 'groups'}/${encodeURIComponent(target.id)}`;

/**
 * Which tools a channel or group offers its reader (Phase 28). It changes only with the server's
 * configuration, the group's eGrant link or its clients, so it is read once per target and
 * session. The AI button and the microphone share this one query.
 */
export const aiToolsQuery = (target: AiTarget) =>
  queryOptions({
    queryKey: ['chat', 'ai-tools', target.kind, target.id ?? null],
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
