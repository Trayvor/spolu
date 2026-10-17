import { useTranslation } from 'react-i18next';
import { useRememberedState } from '@/lib/use-remembered-filters';
import { cn } from '@/lib/utils';
import { CardsViewIcon, ListViewIcon } from './icons';

export type KnowledgeView = 'list' | 'cards';

const VIEWS = ['cards'] as const;

/**
 * The knowledge lists' view (owner request of 2026-10-17): the list (default) or cards. One
 * choice per signed-in user for the global list and every group's tab, kept in the browser
 * (`spolu.filters.<user>.knowledge:view`); blocked storage just forgets it.
 */
export function useKnowledgeView(): [KnowledgeView, (next: KnowledgeView) => void] {
  const [saved, setSaved] = useRememberedState('knowledge:view', VIEWS);
  return [saved ?? 'list', (next) => setSaved(next === 'cards' ? 'cards' : null)];
}

// 36 px segments with a 44 px tap area (a `before:` inset), as the type pills.
const segment =
  "relative inline-flex h-9 w-11 items-center justify-center rounded-full before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** List / Cards: two pressed-state buttons in one pill. */
export function ViewToggle({
  view,
  onChange,
}: {
  view: KnowledgeView;
  onChange: (next: KnowledgeView) => void;
}) {
  const { t } = useTranslation();
  const options = [
    { value: 'list', label: t('knowledge.view.list'), Icon: ListViewIcon },
    { value: 'cards', label: t('knowledge.view.cards'), Icon: CardsViewIcon },
  ] as const;
  return (
    <div
      role="group"
      aria-label={t('knowledge.view.label')}
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-secondary p-0.5"
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          aria-label={label}
          title={label}
          onClick={() => onChange(value)}
          className={cn(
            segment,
            view === value
              ? 'bg-primary text-primary-foreground'
              : 'text-secondary-foreground hover:bg-surface-3',
          )}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
