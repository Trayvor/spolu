import { lazy, Suspense, useState, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Announcement, CurrentAnnouncement } from '@spolu/shared';
import { withNamespaces } from '@/i18n/namespaces';
import { apiGet, apiSend, type ResponseParser } from '@/lib/api';

type DialogProps = { announcement: Announcement; onClose: () => void };

/** The popup's own chunk with the `whatsNew` texts: loaded only when there is something to show. */
const LazyWhatsNewDialog = lazy((): Promise<{ default: ComponentType<DialogProps> }> =>
  withNamespaces(['whatsNew'], () => import('./whats-new-dialog'))().then(
    (module) => ({ default: module.WhatsNewDialog }),
    // A failed chunk (offline, new deploy): no popup this time; it is not marked seen.
    () => ({ default: () => null }),
  ),
);

/** A hand-written guard: this chunk loads on every app start, so it carries no zod. */
const currentGuard: ResponseParser<CurrentAnnouncement> = {
  safeParse(data) {
    const announcement = (data as { announcement?: unknown } | null)?.announcement;
    if (announcement === null) return { success: true, data: { announcement: null } };
    const a = announcement as { id?: unknown; sections?: unknown } | undefined;
    if (typeof a?.id !== 'string' || !Array.isArray(a.sections)) return { success: false };
    const sections = a.sections.filter((s): s is string => typeof s === 'string');
    return {
      success: true,
      data: { announcement: { id: a.id, sections: sections as Announcement['sections'] } },
    };
  },
};

const announcementQueryKey = ['me', 'announcement'] as const;

/**
 * "What's new" (ADR 0067): asks the server once per app load (never per route) which
 * announcement to show; the server already left out what the person cannot use. Closing it in
 * any way marks it seen on the server, so it never comes back on any device. Mounted by the
 * signed-in layout (a lazy chunk), once the person has a name.
 */
export function WhatsNewHost() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: announcementQueryKey,
    queryFn: () => apiGet('/me/announcement', currentGuard),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const [closed, setClosed] = useState<string | null>(null);
  const announcement = data?.announcement;
  if (!announcement || announcement.sections.length === 0 || closed === announcement.id) {
    return null;
  }

  const close = () => {
    setClosed(announcement.id);
    queryClient.setQueryData(announcementQueryKey, { announcement: null });
    // Best effort: a failed request shows it once more on the next app load.
    apiSend('POST', `/me/announcement/${encodeURIComponent(announcement.id)}/seen`).catch(
      () => undefined,
    );
  };
  return (
    <Suspense fallback={null}>
      <LazyWhatsNewDialog announcement={announcement} onClose={close} />
    </Suspense>
  );
}

export default WhatsNewHost;
