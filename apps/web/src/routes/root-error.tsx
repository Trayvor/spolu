import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button-variants';

// The message of the error the last retry tried to recover from. If the same one comes back, a
// reset cannot help (a cached failure), so the next retry reloads the page.
let retried: string | undefined;
/** The reload goes through here so a test can spy on it (jsdom's location cannot be replaced). */
export const page = { reload: () => window.location.reload() };
/** Tests only. */
export const resetRetryMemory = () => {
  retried = undefined;
};

// A lazy chunk that no longer exists (stale deploy) or could not be fetched: only a reload helps.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|ChunkLoadError/i;

/**
 * Shown when a route fails to load (for example `/api/me` is down). A retry resets the boundary
 * and runs the guards and loaders again; a failed chunk, or the same error twice, reloads the page.
 */
export function RootError({ error, reset }: { error?: unknown; reset: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    <div role="alert" className="mx-auto flex max-w-[552px] flex-col items-start gap-6 px-5 py-16">
      <p className="text-medium font-semibold">{t('errors.generic')}</p>
      {/* A plain button with the Button classes: `Button` would bring `cn` into the initial JS. */}
      <button
        type="button"
        className={buttonVariants()}
        onClick={() => {
          if (CHUNK_ERROR.test(message) || retried === message) {
            page.reload();
            return;
          }
          retried = message;
          reset();
          void router.invalidate();
        }}
      >
        {t('errors.retry')}
      </button>
    </div>
  );
}
