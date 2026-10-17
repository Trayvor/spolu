import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { NavCount } from '@/components/lazy-nav-count';
import type { NavSection } from '@/components/nav-sections';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { cn } from '@/lib/utils';

/**
 * From 641 px (tablets, small laptops: an admin's links need 1280 px) the sheet is a 320 px panel
 * under the header's right end that grows in like a dropdown, over a clear backdrop.
 */
const PANEL_FROM_641 =
  'min-[641px]:top-[96px] min-[641px]:right-[max(clamp(20px,4vw,40px),calc((100vw-1152px)/2))] min-[641px]:bottom-auto min-[641px]:left-auto min-[641px]:max-h-[calc(100dvh-120px)] min-[641px]:w-[320px] min-[641px]:origin-top-right min-[641px]:animate-menu-in min-[641px]:rounded-xl min-[641px]:backdrop:bg-transparent min-[641px]:data-closing:animate-menu-out [&>div]:min-[641px]:pb-2 [&>div>[aria-hidden]]:min-[641px]:hidden';

/**
 * The section menu's sheet (the lazy `section-sheet` chunk, loaded on the first tap of
 * `SectionMenu`): on phones a bottom sheet with every section as a 48 px row within thumb reach,
 * the current one marked (`aria-current`), Tasks and Tickets with the header's counts. A tap on a
 * row goes there and slides the sheet away.
 */
export default function SectionSheet({
  sections,
  current,
  onClose,
}: {
  sections: readonly NavSection[];
  current: NavSection | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet label={t('nav.menu')} onClose={onClose} className={PANEL_FROM_641}>
      <nav aria-label={t('nav.menu')}>
        <ul className="flex flex-col gap-0.5">
          {sections.map((section) => {
            const active = section.key === current?.key;
            return (
              <li key={section.key}>
                <Link
                  to={section.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-12 items-center gap-3 rounded-lg px-4 text-button transition-colors duration-(--duration-fast) hover:bg-accent hover:text-foreground focus-visible:bg-accent active:bg-accent',
                    active ? 'bg-secondary font-semibold' : 'font-medium',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {section.name ?? t(section.label ?? '')}
                  </span>
                  {section.count && <NavCount kind={section.count} />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </BottomSheet>
  );
}
