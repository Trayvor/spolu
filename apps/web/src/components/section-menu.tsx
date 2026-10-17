import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
} from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon } from '@/components/language-switcher';
import { currentSection, type NavSection } from '@/components/nav-sections';
// `clsx`, not `cn`: these classes never conflict, and `cn` would bring tailwind-merge into the
// initial JS.
import { clsx } from 'clsx';

const loadSheet = () => import('./section-sheet');
// A chunk that fails to load (offline, new deploy) closes again instead of breaking the header.
type SheetProps = ComponentProps<typeof import('./section-sheet').default>;
const SectionSheet = lazy((): Promise<{ default: ComponentType<SheetProps> }> =>
  loadSheet().catch(() => ({
    default: function Unavailable({ onClose }: { onClose: () => void }) {
      useEffect(onClose, [onClose]);
      return null;
    },
  })),
);

/**
 * The section menu, where the header has no room for the section links (`AppHeader`): a
 * `bg-secondary` pill named after the section the page belongs to ("Tasks"), or "Menu" on a page
 * of none (Settings), with a chevron. A tap opens the sections as a bottom sheet
 * (`SectionSheet`, a lazy chunk fetched when the finger or pointer reaches the pill). The pill's
 * name says it is the menu and where you are ("Menu: Tasks"). Its tap area is 44 px.
 */
export function SectionMenu({
  sections,
  className,
}: {
  sections: readonly NavSection[];
  /** Hides the pill where the header shows the section links instead. */
  className: string;
}) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [open, setOpen] = useState(false);
  const current = currentSection(sections, pathname);
  const name = current ? (current.name ?? t(current.label ?? '')) : t('nav.menu');
  const warm = () => void loadSheet().catch(() => undefined);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={current ? t('nav.menuCurrent', { name }) : name}
        onPointerEnter={warm}
        onTouchStart={warm}
        onFocus={warm}
        onClick={() => setOpen(true)}
        className={clsx(
          'relative inline-flex h-[38px] min-w-0 items-center gap-1 rounded-full bg-secondary pr-2 pl-3 text-tiny font-semibold text-secondary-foreground transition-colors duration-(--duration-fast) after:absolute after:-inset-[3px] after:rounded-full hover:bg-surface-3 aria-expanded:bg-surface-3',
          className,
        )}
      >
        <span className="min-w-0 truncate">{name}</span>
        <span className="shrink-0">
          <ChevronDownIcon />
        </span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <SectionSheet sections={sections} current={current} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
