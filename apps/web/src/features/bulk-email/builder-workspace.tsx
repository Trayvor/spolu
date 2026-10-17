import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { createHighlighter, type Highlighter } from './preview-highlight';

export type WorkspaceTab = 'blocks' | 'preview';
const TABS: WorkspaceTab[] = ['blocks', 'preview'];

type WorkspaceLink = { highlighter: Highlighter; select: (blockId: string) => void };

const WorkspaceContext = createContext<WorkspaceLink | null>(null);
const unlinked: WorkspaceLink = { highlighter: createHighlighter(), select: () => {} };

/** The preview's link to the builder: the highlighter and "select this block". */
export function useWorkspaceLink(): WorkspaceLink {
  return useContext(WorkspaceContext) ?? unlinked;
}

const blockIdOf = (target: EventTarget | null): string | null =>
  (target as Element | null)?.closest?.('[data-block-id]')?.getAttribute('data-block-id') ?? null;

/**
 * The builder's two panes (spec 2026-10-17-bulk-email-builder-layout): the blocks on the left,
 * the live preview on the right, sticky and scrolling on its own, once the workspace is at least
 * 840 px wide; narrower (tablets, phones) one pane at a time behind the Blocks / Preview tabs.
 * Pure CSS container queries decide which: no resize listener.
 *
 * It owns the highlight: hovering or focusing a block card outlines the block in the preview,
 * and a click in the preview (`select`) brings its card into view and focuses it.
 */
export function BuilderWorkspace({
  tab,
  onTab,
  blocks,
  preview,
}: {
  tab: WorkspaceTab;
  onTab: (tab: WorkspaceTab) => void;
  blocks: ReactNode;
  /** The preview; it reaches the highlighter through `useWorkspaceLink`. */
  preview: ReactNode;
}) {
  const { t } = useTranslation();
  const [highlighter] = useState(createHighlighter);
  const builderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    highlighter.attachBuilder(builderRef.current);
    return () => highlighter.attachBuilder(null);
  }, [highlighter]);
  // New or moved cards come without the mark: put it back after every render (≤ 50 cards).
  useEffect(() => highlighter.refreshBuilder());

  // A block picked in the preview: on a phone first back to the Blocks tab (rendered at once,
  // so the card can be measured and focused), then its card in the middle of the window.
  const select = useCallback(
    (id: string) => {
      highlighter.activate(id, false);
      flushSync(() => onTab('blocks'));
      const card = [...(builderRef.current?.querySelectorAll('[data-block-id]') ?? [])].find(
        (el) => el.getAttribute('data-block-id') === id,
      ) as HTMLElement | undefined;
      if (!card) return;
      card.scrollIntoView?.({ block: 'center' });
      card.focus({ preventScroll: true });
    },
    [highlighter, onTab],
  );
  const link = useMemo(() => ({ highlighter, select }), [highlighter, select]);

  return (
    <div className="@container flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={t('bulkEmail.workspace.label')}
        // Tabs, not a second pill switch: they change the view, the Computer / Phone pill
        // above changes what is edited.
        className="grid grid-cols-2 border-b-2 border-border @min-[840px]:hidden"
      >
        {TABS.map((name) => (
          <button
            key={name}
            id={`workspace-tab-${name}`}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls={`workspace-${name}`}
            onClick={() => onTab(name)}
            className={cn(
              '-mb-0.5 h-11 border-b-2 px-4 text-button font-semibold transition-colors duration-(--duration-fast)',
              tab === name
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`bulkEmail.workspace.${name}`)}
          </button>
        ))}
      </div>
      <div className="grid gap-6 @min-[840px]:grid-cols-[minmax(360px,1fr)_minmax(0,1.15fr)] @min-[840px]:items-start">
        <div
          id="workspace-blocks"
          role="tabpanel"
          aria-labelledby="workspace-tab-blocks"
          ref={builderRef}
          className={cn('min-w-0', tab !== 'blocks' && 'hidden @min-[840px]:block')}
          onPointerOver={(e) => highlighter.hover(blockIdOf(e.target))}
          onPointerLeave={() => highlighter.hover(null)}
          onFocus={(e) => highlighter.activate(blockIdOf(e.target))}
        >
          {blocks}
        </div>
        <div
          id="workspace-preview"
          role="tabpanel"
          aria-labelledby="workspace-tab-preview"
          className={cn(
            'flex h-[min(80dvh,880px)] min-h-[480px] min-w-0 flex-col @min-[840px]:sticky @min-[840px]:top-4 @min-[840px]:h-[calc(100dvh-2rem)]',
            tab !== 'preview' && 'hidden @min-[840px]:flex',
          )}
        >
          <WorkspaceContext.Provider value={link}>{preview}</WorkspaceContext.Provider>
        </div>
      </div>
    </div>
  );
}
