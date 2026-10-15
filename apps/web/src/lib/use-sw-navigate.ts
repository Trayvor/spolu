import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';

/** Follow a notification click: the service worker posts the path to an already open tab. */
export function useSwNavigate(): void {
  const router = useRouter();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type !== 'spolu:navigate' || typeof data.url !== 'string') return;
      if (!data.url.startsWith('/')) return;
      void router.navigate({ href: data.url });
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);
}
