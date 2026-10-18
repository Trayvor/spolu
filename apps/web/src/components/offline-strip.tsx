import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** The browser's own verdict; `navigator.onLine` is true where it cannot tell. */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * A strip under the header while the browser is offline. It promises nothing the app does not
 * do: screens keep showing what they loaded, but a write (the HTTP API) fails or waits, and
 * nothing is queued across a reload. So it says changes will not be saved until the connection
 * is back; a chat message that failed stays in the list with its retry.
 */
export function OfflineStrip() {
  const { t } = useTranslation();
  if (useOnline()) return null;
  return (
    <p
      role="status"
      className="mx-auto mt-2 w-full max-w-[1600px] rounded-lg bg-attention px-4 py-2 text-center text-tiny font-semibold text-attention-foreground"
    >
      {t('nav.offline')}
    </p>
  );
}
