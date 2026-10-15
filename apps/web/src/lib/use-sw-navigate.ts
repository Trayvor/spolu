import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';

/** The path, search and hash of a same-origin url (as the browser parses it); null otherwise. */
export function sameOriginPath(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return null;
  }
}

/** Follow a notification click: the service worker posts the path to an already open tab. */
export function useSwNavigate(): void {
  const router = useRouter();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type !== 'spolu:navigate') return;
      const href = sameOriginPath(data.url);
      if (href) void router.navigate({ href });
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);
}
