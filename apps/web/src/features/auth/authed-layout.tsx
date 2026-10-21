import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useRouter } from '@tanstack/react-router';
import { RouteFade } from '@/components/route-fade';
import { readCollapsed } from '@/features/admin-home/sidebar-collapse';
import { useMeChanged } from '@/features/finance/use-me-changed';
import { useManagerEvents } from '@/features/groups/use-manager-events';
import { AppPrompt } from '@/features/notifications/app-prompt';
import { saveLanguage } from '@/features/profile/language-api';
import { TimeDialogHost } from '@/features/tasks/time-dialog-host';
import { i18n } from '@/i18n';
import { withNamespaces } from '@/i18n/namespaces';
import { useMediaQuery } from '@/lib/use-media-query';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { redirectToLogin } from './go-to-login';
import { isAdmin } from './roles';
import { clearSession, sessionQuery, useSession } from './use-session';

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Layout of every signed-in screen. Owns the realtime connection: it opens once the session
 * is known and closes when the session goes (logout, 401) or the layout goes away.
 * The server refuses a handshake without a session with `unauthorized`: the session is gone,
 * so go to /login (Socket.IO does not retry after that error, and we do not either).
 * `server_error` only means "try later": the user stays signed in and the layout reconnects
 * after 1 s, 2 s, 4 s ... up to 30 s (reset by a successful connect).
 * When the server itself ends the connection (`io server disconnect`, e.g. the admin was
 * removed) Socket.IO does not reconnect, so ask /api/me: no session means the same trip to
 * /login.
 * It also mounts `<AppPrompt>`, the install and enable-notifications banner above the page,
 * and once per signed-in user stores the UI language on the server (the language of their
 * emails and pushes; best effort). It listens for manager changes of every group
 * (`useManagerEvents`) for the whole session.
 */

export function AuthedLayout() {
  const session = useSession();
  const userId = session?.id;
  const queryClient = useQueryClient();
  const router = useRouter();
  const languageSavedFor = useRef<string | null>(null);
  useManagerEvents();
  useMeChanged();

  useEffect(() => {
    if (!userId || languageSavedFor.current === userId) return;
    languageSavedFor.current = userId;
    saveLanguage(i18n.language).catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    // `server_error` ends the handshake and Socket.IO does not retry it: try again with backoff.
    let delay = RECONNECT_MIN_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onConnect() {
      delay = RECONNECT_MIN_MS;
    }
    function onConnectError(error: Error) {
      if (error.message === 'server_error') {
        clearTimeout(timer);
        timer = setTimeout(connectSocket, delay);
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
        return;
      }
      if (error.message !== 'unauthorized') return;
      clearSession(queryClient);
      void redirectToLogin(router);
    }
    async function onDisconnect(reason: string) {
      if (reason !== 'io server disconnect') return;
      try {
        const current = await queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
        if (current) return; // still signed in: the socket stays disconnected until a reload (no reconnect after a server-side disconnect)
      } catch {
        return; // /api/me is down: stay as we are, the next request will tell
      }
      clearSession(queryClient);
      void redirectToLogin(router);
    }
    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);
    connectSocket();
    return () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      disconnectSocket();
    };
  }, [userId, queryClient, router]);

  return (
    <>
      <AppPrompt />
      {/* Time on done (Phase 32): the time dialog and its queue, for admins. */}
      {isAdmin(session) && <TimeDialogHost />}
      {/* "What's new" (ADR 0067): one small request per app load, after the name step. */}
      {session && session.name.trim() !== '' && (
        <Suspense fallback={null}>
          <LazyWhatsNewHost />
        </Suspense>
      )}
      <SignedInFrame>
        {/* Moving to another screen fades it in; the sidebar stays as it is. */}
        <RouteFade level={2} className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </RouteFade>
      </SignedInFrame>
    </>
  );
}

/**
 * "What's new": its own small chunk (no zod, no texts); the popup and its texts are a second
 * chunk, loaded only when there is an announcement to show.
 */
const LazyWhatsNewHost = lazy((): Promise<{ default: () => ReactNode }> =>
  import('@/features/whats-new/whats-new-host').then(
    (module) => ({ default: module.WhatsNewHost }),
    () => ({ default: () => null }),
  ),
);

/** The admin sidebar's lazy chunk (`admin-shell`) with its texts; clients never download it. */
const LazyAdminSidebar = lazy((): Promise<{ default: () => ReactNode }> =>
  withNamespaces(['adminHome'], () => import('@/features/admin-home/admin-shell'))().then(
    (module) => ({ default: module.AdminSidebar }),
    // A failed chunk (offline, new deploy) leaves the page without the sidebar, not broken.
    () => ({ default: () => null }),
  ),
);

/** Holds the sidebar's place while its chunk loads, at the width it will have. */
function SidebarPlaceholder() {
  return (
    <div aria-hidden="true" className={readCollapsed() ? 'w-14 shrink-0' : 'w-[232px] shrink-0'} />
  );
}

/**
 * The two-column frame of the signed-in screens: for an admin from 1024 px the client sidebar
 * sits on the left of every page, so moving between clients never reloads it. The page keeps its
 * place in the tree whether or not the sidebar shows, so it never remounts when it loads.
 */
export function SignedInFrame({ children }: { children: ReactNode }) {
  const admin = isAdmin(useSession());
  const wide = useMediaQuery('(min-width: 1024px)');
  return (
    <div className="flex flex-1 gap-6">
      {admin && wide && (
        <Suspense fallback={<SidebarPlaceholder />}>
          <LazyAdminSidebar />
        </Suspense>
      )}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
