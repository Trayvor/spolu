import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { withNamespaces } from '@/i18n/namespaces';

type PaletteProps = { onClose: () => void };

let started: Promise<{ default: ComponentType<PaletteProps> }> | undefined;
/** The palette and its `search` texts: a lazy chunk, fetched on first use or on hover. */
const loadPalette = (): Promise<{ default: ComponentType<PaletteProps> }> =>
  (started ??= withNamespaces(['search'], () => import('@/features/search/command-palette'))()
    .then((m) => ({ default: m.CommandPalette }))
    .catch((error: unknown) => {
      started = undefined;
      throw error;
    }));

// A chunk that fails to load (offline, new deploy) closes again instead of breaking the header.
const Palette = lazy((): Promise<{ default: ComponentType<PaletteProps> }> =>
  loadPalette().catch(() => ({
    default: function Unavailable({ onClose }: PaletteProps) {
      useEffect(onClose, [onClose]);
      return null;
    },
  })),
);

/**
 * The global search's only eager part (2026-10-18): the header's search button and the
 * Cmd/Ctrl+K shortcut. Both open the command palette (`features/search/command-palette`, a lazy
 * chunk), a panel from 641 px and a full-screen sheet on phones.
 */
export function SearchTrigger() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const warm = () => void loadPalette().catch(() => undefined);
  const label = t('nav.search');
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
        title={label}
        onPointerEnter={warm}
        onTouchStart={warm}
        onFocus={warm}
        onClick={() => setOpen(true)}
        className="relative inline-flex size-[38px] shrink-0 items-center justify-center rounded-full transition-colors duration-(--duration-fast) after:absolute after:-inset-[3px] after:rounded-full hover:bg-accent aria-expanded:bg-secondary"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>
      {open && (
        <Suspense fallback={null}>
          <Palette onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
