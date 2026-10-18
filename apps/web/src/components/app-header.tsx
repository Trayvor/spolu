import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useBottomNavPlan } from '@/components/bottom-nav';
import { LanguageSwitcher } from '@/components/language-switcher';
import { NavCount } from '@/components/lazy-nav-count';
import { NotificationBell } from '@/components/notification-bell';
import { navSections } from '@/components/nav-sections';
import { SearchTrigger } from '@/components/search-trigger';
import { SectionMenu } from '@/components/section-menu';
import { isAdmin } from '@/features/auth/roles';
import { UserMenu } from '@/features/auth/user-menu';
import { useSession } from '@/features/auth/use-session';

// Plain strings, no `cn`: tailwind-merge (about 8 kB gzip) stays out of the initial JS. The
// display is `inline-flex` when the links always fit, else `hidden` until the width in `WIDE`.
const navLink =
  'h-[38px] shrink-0 items-center rounded-full text-tiny font-semibold transition-colors duration-(--duration-fast) hover:bg-accent aria-[current=page]:bg-secondary';
// Where the section links fit in the pill: an admin's seven need about 1 100 px. A finance
// admin's eight (Phase 32) fit the 1 152 px pill only with 12 px instead of 16 px padding and
// 4 px gaps (measured in Slovak; Ukrainian overflows a few pixels, as the seven already do).
// The notification bell and the search button (2026-10-18) take 46 px each, so the links wait
// for 1440 px (an admin) and 1536 px (a finance admin) instead of 1280 px.
const WIDE = {
  admin: {
    links: 'min-[1440px]:inline-flex',
    menu: 'min-[1440px]:hidden',
    pad: 'px-4',
    gap: 'gap-2',
  },
  finance: {
    links: 'min-[1536px]:inline-flex',
    menu: 'min-[1536px]:hidden',
    pad: 'px-3',
    gap: 'gap-1',
  },
  other: {
    links: 'min-[641px]:inline-flex',
    menu: 'min-[641px]:hidden',
    pad: 'px-4',
    gap: 'gap-2',
  },
} as const;

/**
 * The egrant.sk header pill, kept still (no hide-on-scroll). On the left the brand
 * "Help by eGrant": the product name as the wordmark, a small "by" and the egrant logo,
 * one link to `/` named by `app.fullName`. On the right, for a signed-in user, the sections
 * (`navSections`: admins' Home, Tasks, Tickets, Knowledge, Groups, Admins and Bulk email; a
 * client's My groups and tickets), the search button (Cmd/Ctrl+K, `SearchTrigger`), the
 * notification bell (the centre), the account menu and the language menu.
 * Where they fit (from 1440 px for an admin's seven, 1536 px for a finance admin's eight, from
 * 641 px for a client's one or two) the
 * sections are links, the current one on a `secondary` pill. Narrower, two or more sections fold
 * into the section menu (`SectionMenu`: a bottom sheet on phones, a panel under the pill on
 * tablets and small laptops) and a single one stays a link. On a phone the bottom bar
 * (`BottomNav`) leads to the sections instead and the pill is hidden, except on screens without
 * the bar (a ticket, a task panel; a requester). Under 641 px the language menu
 * moves into the account menu.
 * For admins "Tasks" and "Tickets" carry a count (my open tasks; the active tickets of my clients
 * and those without a client), hidden at 0, in the links and in the section menu.
 * Its top margin clears the iPhone notch when the app runs full screen.
 */
export function AppHeader() {
  const { t } = useTranslation();
  const user = useSession();
  const sections = user ? navSections(user) : [];
  const folded = sections.length > 1;
  // Where the phone bottom bar leads to the sections, the pill would only repeat it.
  const barOnPhone = useBottomNavPlan() !== null;
  const wide = WIDE[!isAdmin(user) ? 'other' : user?.finance ? 'finance' : 'admin'];
  return (
    <header className="mx-auto mt-[max(12px,env(safe-area-inset-top))] flex h-[54px] w-full max-w-[1600px] items-center gap-2 rounded-nav bg-background px-3 shadow-lift min-[641px]:mt-6 min-[641px]:h-16 min-[641px]:gap-3 min-[641px]:px-6">
      <Link
        to="/"
        aria-label={t('app.fullName')}
        className="flex shrink-0 items-baseline gap-2 hover:text-foreground"
      >
        <span className="text-wordmark leading-none font-semibold tracking-[-0.4px]">
          {t('app.name')}
        </span>
        <span className="text-micro text-muted-foreground">by</span>
        <img
          src="/brand/egrant-logo.svg"
          alt=""
          width={212}
          height={40}
          className="h-[17px] w-auto max-[399px]:h-[15px] min-[641px]:h-[22px]"
        />
      </Link>
      <div className={`ml-auto flex min-w-0 items-center ${wide.gap}`}>
        {sections
          .filter((section) => section.label)
          .map((section) => (
            <Link
              key={section.key}
              to={section.to}
              activeOptions={{ exact: section.to === '/' }}
              className={`${navLink} ${wide.pad} ${folded ? `hidden ${wide.links}` : 'inline-flex'}`}
            >
              {t(section.label!)}
              {section.count && <NavCount kind={section.count} live={section.count === 'tasks'} />}
            </Link>
          ))}
        {folded && (
          <SectionMenu
            sections={sections}
            className={barOnPhone ? `${wide.menu} max-[640px]:hidden` : wide.menu}
          />
        )}
        {user && <SearchTrigger />}
        {user && <NotificationBell />}
        {user && <UserMenu user={user} />}
        <LanguageSwitcher />
      </div>
    </header>
  );
}
