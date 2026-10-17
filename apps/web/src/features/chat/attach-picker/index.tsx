import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { PanelHeader } from '@/components/ui/panel-header';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { cn } from '@/lib/utils';
import { KnowledgePickList } from '../knowledge-picker';
import { PickedChips } from './chips';
import { pickedCount, type Picked } from './picked';
import { TasksTab } from './tasks-tab';
import { TicketsTab } from './tickets-tab';

type Tab = 'knowledge' | 'tasks' | 'tickets';
const TABS: readonly Tab[] = ['knowledge', 'tasks', 'tickets'];
const TAB_KEY = 'spolu.attachTab';

/** The last tab used, kept per browser; storage may be unavailable, then the first tab opens. */
function rememberedTab(): Tab {
  try {
    const value = localStorage.getItem(TAB_KEY);
    return TABS.find((tab) => tab === value) ?? 'knowledge';
  } catch {
    return 'knowledge';
  }
}

function remember(tab: Tab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Not remembering is fine.
  }
}

/**
 * Phase 34: the composer's attachment picker (a lazy chunk): a dialog (a sheet on phones) with
 * three tabs, Knowledge, Tasks and Tickets of the group, a search in each, and at the bottom what
 * is picked across all three as chips and "Attach (n)". Each kind holds at most its own limit.
 */
export default function AttachPicker({
  groupId,
  picked,
  onDone,
  onClose,
}: {
  groupId: string;
  picked: Picked;
  onDone: (picked: Picked) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [tab, setTab] = useState<Tab>(rememberedTab);
  const [chosen, setChosen] = useState<Picked>(picked);
  const choose = (next: Tab) => {
    setTab(next);
    remember(next);
  };
  const setKind =
    <K extends keyof Picked>(kind: K) =>
    (update: (list: Picked[K]) => Picked[K]) =>
      setChosen((all) => ({ ...all, [kind]: update(all[kind]) }));

  return (
    <SheetDialog onEscape={onClose} initialFocus={titleRef} testId="attach-picker">
      <PanelHeader onClose={onClose} compactBelow={641} backLabel={t('chat.knowledge.back')}>
        <Button size="sm" className="ml-auto" onClick={() => onDone(chosen)}>
          {t('chat.knowledge.attachCount', { count: pickedCount(chosen) })}
        </Button>
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:py-5">
        <SheetDialogTitle
          ref={titleRef}
          tabIndex={-1}
          className="text-medium font-semibold outline-none"
        >
          {t('chat.work.pickerTitle')}
        </SheetDialogTitle>
        <div role="tablist" aria-label={t('chat.work.pickerTitle')} className="flex gap-1">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`attach-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="attach-panel"
              onClick={() => choose(id)}
              className={cn(
                'rounded-full px-3 py-1.5 text-button font-semibold max-[640px]:min-h-11',
                tab === id
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {t(`chat.work.tabs.${id}`)}
              {chosen[id].length > 0 && <span className="ml-1.5">{chosen[id].length}</span>}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="attach-panel"
          aria-labelledby={`attach-tab-${tab}`}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          {tab === 'knowledge' && (
            <KnowledgePickList
              groupId={groupId}
              chosen={chosen.knowledge}
              setChosen={setKind('knowledge')}
            />
          )}
          {tab === 'tasks' && (
            <TasksTab groupId={groupId} chosen={chosen.tasks} setChosen={setKind('tasks')} />
          )}
          {tab === 'tickets' && (
            <TicketsTab groupId={groupId} chosen={chosen.tickets} setChosen={setKind('tickets')} />
          )}
        </div>
        <PickedChips
          picked={chosen}
          kinds={TABS}
          onRemove={(kind, id) =>
            setChosen((all) => ({
              ...all,
              [kind]: (all[kind] as { id: string }[]).filter((x) => x.id !== id),
            }))
          }
        />
      </div>
    </SheetDialog>
  );
}
