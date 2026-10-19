import { useEffect } from 'react';
import { apiSend } from '@/lib/api';

const PATHS = { project: 'projects', knowledge: 'knowledge', event: 'project-events' } as const;

/**
 * Tells the server the viewer opened a project, a knowledge item (2026-10-18) or a project event
 * (2026-10-19): a mention of them in its description from before is then read on the admin
 * home's Mentions card, and their notification centre items about it are read. Once per
 * open (`id` null marks nothing); a failed request is ignored, the next open marks it.
 */
export function useMarkOpened(kind: keyof typeof PATHS, id: string | null): void {
  useEffect(() => {
    if (!id) return;
    apiSend('POST', `/${PATHS[kind]}/${encodeURIComponent(id)}/seen`).catch(() => undefined);
  }, [kind, id]);
}
