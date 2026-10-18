import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { navCountsQuery } from '@/features/admin-home/api';
import { groupChatQuery } from '@/features/chat/api';
import { boardUnseenQuery } from '@/features/tasks/unseen';
import type { BarItem, BottomNavPlan } from './bottom-nav-plan';
import { Glyph, GLYPHS } from './section-glyphs';
import SectionSheet from './section-sheet';

// The lazy `bottom-nav-bar` chunk: the phone bottom bar (see `bottom-nav.tsx`). Admins' counts
// are the header's (its Tasks link keeps them live); a client's are the Chat and Tasks tabs'
// (the group layout keeps them live while a group is open).

const tab =
  'relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-nano font-semibold text-muted-foreground transition-colors duration-(--duration-fast) hover:text-foreground aria-[current=page]:bg-secondary aria-[current=page]:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground';

function Badge({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <span
      data-testid="bottom-nav-count"
      className="absolute top-1 left-1/2 ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-nano leading-none font-semibold text-primary-foreground tabular-nums"
    >
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{t('bottomNav.count', { count })}</span>
    </span>
  );
}

function AdminCount({ kind }: { kind: 'tasks' | 'tickets' }) {
  return <Badge count={useQuery(navCountsQuery).data?.[kind] ?? 0} />;
}
function ChatCount({ groupId }: { groupId: string }) {
  return <Badge count={useQuery(groupChatQuery(groupId)).data?.unread ?? 0} />;
}
function TasksCount({ groupId }: { groupId: string }) {
  return <Badge count={useQuery(boardUnseenQuery(groupId)).data?.size ?? 0} />;
}

function Count({ item }: { item: BarItem }) {
  if (item.count === 'tasks' || item.count === 'tickets') return <AdminCount kind={item.count} />;
  if (!('groupId' in item)) return null;
  if (item.count === 'chat') return <ChatCount groupId={item.groupId} />;
  if (item.count === 'groupTasks') return <TasksCount groupId={item.groupId} />;
  return null;
}

/**
 * The phone bottom bar (X4): a floating pill like the header, four sections and "More" (the
 * rest, in the section sheet). 56 px high items, so every tap area is over 44 px; the pill sits
 * above the home bar (`safe-area-inset-bottom`) and the page above it keeps its room
 * (`RootLayout`). The current section is the filled `secondary` item. Counts are ink bubbles
 * over the icon, hidden at 0.
 */
export default function BottomNavBar({ plan }: { plan: BottomNavPlan }) {
  const { t } = useTranslation();
  const [more, setMore] = useState(false);
  return (
    <>
      <nav
        aria-label={t('bottomNav.label')}
        className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 mx-auto flex h-14 max-w-[440px] items-center gap-0.5 rounded-nav bg-background px-1.5 shadow-lift"
      >
        {plan.items.map((item) => (
          <Link
            key={item.key}
            // The union of routes with and without params: the item carries its own.
            to={item.to}
            params={('groupId' in item ? { groupId: item.groupId } : undefined) as never}
            // Switching sections in a group is not a step (like the group tabs): Back leaves it.
            replace={'groupId' in item}
            activeOptions={{ exact: item.to === '/' }}
            className={tab}
          >
            <Glyph>{GLYPHS[item.key]}</Glyph>
            <span className="max-w-full truncate">{t(item.label)}</span>
            <Count item={item} />
          </Link>
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={more}
          aria-current={plan.moreCurrent ? 'page' : undefined}
          onClick={() => setMore(true)}
          className={tab}
        >
          <Glyph>{GLYPHS.more}</Glyph>
          <span className="max-w-full truncate">{t('bottomNav.more')}</span>
        </button>
      </nav>
      {more && (
        <SectionSheet
          sections={plan.more}
          current={plan.moreCurrent}
          onClose={() => setMore(false)}
        />
      )}
    </>
  );
}
