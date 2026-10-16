import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { CardList, CountFigure, type CountCardProps } from './count-card';

function BackArrow() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * A card on a phone: a tile with the card's title, the count, its caption and subline (the title
 * tells the Tickets and My tasks tiles apart); tapping it opens the card's
 * full list in a full-screen sheet with a back button.
 */
export function CountTile(props: CountCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { title, count, caption, subline, state } = props;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${title}: ${count > 99 ? '99+' : count} ${caption}`}
        className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-2 rounded-xl bg-card p-3 text-left hover:bg-accent"
      >
        <span aria-hidden="true" className="w-full truncate text-micro font-semibold">
          {title}
        </span>
        {state === 'ready' ? (
          <CountFigure count={count} caption={caption} subline={subline} />
        ) : (
          <span aria-hidden="true" className="h-9 w-10 rounded-lg bg-secondary" />
        )}
      </button>
      {open && (
        <SheetDialog onEscape={() => setOpen(false)}>
          <div className="flex items-center gap-2 border-b-2 border-border px-2 py-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('adminHome.cards.back')}
              onClick={() => setOpen(false)}
            >
              <BackArrow />
            </Button>
            <SheetDialogTitle className="text-body font-semibold">{title}</SheetDialogTitle>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
            <CardList
              rows={props.rows}
              empty={props.empty}
              showAll={props.showAll}
              state={state}
              onRetry={props.onRetry}
            />
          </div>
        </SheetDialog>
      )}
    </>
  );
}
