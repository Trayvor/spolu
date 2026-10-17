import { useId } from 'react';
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button, buttonVariants } from '@/components/ui/button';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { cn } from '@/lib/utils';
import {
  CardList,
  CountFigure,
  RowAction,
  TargetLink,
  type CardId,
  type CardRow,
  type CountCardProps,
} from './count-card';

function BackArrow() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** Marks the history entry the tile pushed, so closing goes back instead of adding an entry. */
const PUSHED = 'homeCardSheet';

/**
 * Which tile's sheet is open: `?card=<id>` on the home URL, so the sheet is a history entry.
 * Back (browser, Android, iOS swipe) closes it and leaves the home screen as it was; a row opened
 * from the sheet comes back to the open sheet.
 */
function useCardSheet(id: CardId) {
  const navigate = useNavigate();
  const router = useRouter();
  const location = useRouterState({ select: (s) => s.location });
  const search = location.search as { card?: unknown };
  const open = search.card === id;
  const show = () =>
    void navigate({
      to: '.',
      search: { ...search, card: id } as never,
      state: { [PUSHED]: true } as never,
      resetScroll: false,
    });
  const close = () => {
    // Opened by the tile in this tab: one step back. Opened from a link or a reload: drop the
    // param in place, so Back then leaves home as usual.
    if (
      (location.state as unknown as Record<string, unknown>)[PUSHED] &&
      router.history.canGoBack()
    ) {
      router.history.back();
      return;
    }
    const rest = { ...search };
    delete rest.card;
    void navigate({ to: '.', search: rest as never, replace: true, resetScroll: false });
  };
  return { open, show, close };
}

/** Rows in their groups, in the order the groups first appear (the rows come sorted). */
function grouped(rows: CardRow[]): { label: string | undefined; rows: CardRow[] }[] {
  const groups: { label: string | undefined; rows: CardRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.label === row.group) last.rows.push(row);
    else groups.push({ label: row.group, rows: [row] });
  }
  return groups;
}

/**
 * The sheet's body: the count and what the list holds, then the rows in groups (overdue, today
 * and this week for tasks; New first for tickets), each with its key details on a second line,
 * and "Open all" to the full list.
 */
function SheetBody(props: CountCardProps) {
  const { count, caption, subline, state, description, openAll } = props;
  const headingBase = useId();
  const rows = props.sheetRows ?? props.rows;
  return (
    <div className="flex flex-col gap-5">
      {state === 'ready' && (
        <div className="flex flex-col gap-2 rounded-xl bg-card p-4">
          <CountFigure count={count} caption={caption} subline={subline} />
          {description && <p className="text-micro text-muted-foreground">{description}</p>}
        </div>
      )}
      {state === 'ready' && rows.length > 0 ? (
        grouped(rows).map((group, index) => {
          const headingId = `${headingBase}-${index}`;
          return (
            <section
              key={group.label ?? index}
              aria-labelledby={group.label ? headingId : undefined}
              className="flex flex-col gap-1"
            >
              {group.label && (
                <h3
                  id={headingId}
                  className="flex items-baseline gap-2 text-micro font-semibold text-muted-foreground"
                >
                  {group.label}
                  <span className="tabular-nums">{group.rows.length}</span>
                </h3>
              )}
              <ul className="flex flex-col rounded-xl bg-card px-3">
                {group.rows.map((row) => (
                  <li key={row.key} className="border-b border-border last:border-b-0">
                    <RowAction
                      row={row}
                      className="-mx-3 flex min-h-14 w-[calc(100%+1.5rem)] items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent hover:text-foreground"
                    >
                      {row.detail ?? row.content}
                    </RowAction>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      ) : (
        <div className={cn(state === 'ready' && 'rounded-xl bg-card px-4 py-3')}>
          <CardList rows={props.rows} empty={props.empty} state={state} onRetry={props.onRetry} />
        </div>
      )}
      {openAll && state !== 'loading' && (
        <TargetLink
          target={openAll.to}
          className={cn(buttonVariants({ variant: 'secondary' }), 'h-11 w-full')}
        >
          {openAll.label}
        </TargetLink>
      )}
    </div>
  );
}

/**
 * A card on a phone: a tile with the card's title, the count, its caption and subline (the title
 * tells the Tickets and My tasks tiles apart); tapping it opens the card's list in a full-screen
 * sheet with a back button. The open sheet is in the URL (`?card=`), see `useCardSheet`.
 */
export function CountTile(props: CountCardProps) {
  const { t } = useTranslation();
  const sheet = useCardSheet(props.id);
  const { title, count, caption, subline, state } = props;
  return (
    <>
      <button
        type="button"
        onClick={sheet.show}
        aria-label={`${title}: ${count > 99 ? '99+' : count} ${caption}`}
        aria-haspopup="dialog"
        className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-2 rounded-xl bg-card p-3 text-left hover:bg-accent"
      >
        <span aria-hidden="true" className="w-full truncate text-micro font-semibold">
          {title}
        </span>
        {state === 'ready' ? (
          <CountFigure count={count} caption={caption} subline={subline} />
        ) : (
          <span aria-hidden="true" className="h-9 w-10 animate-skeleton rounded-lg bg-secondary" />
        )}
      </button>
      {sheet.open && (
        <SheetDialog onEscape={sheet.close} urlOwned>
          <div className="flex items-center gap-2 border-b-2 border-border px-2 py-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('adminHome.cards.back')}
              onClick={sheet.close}
            >
              <BackArrow />
            </Button>
            <SheetDialogTitle className="text-body font-semibold">{title}</SheetDialogTitle>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            <SheetBody {...props} />
          </div>
        </SheetDialog>
      )}
    </>
  );
}
