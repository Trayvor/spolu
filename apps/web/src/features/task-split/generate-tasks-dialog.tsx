import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MESSAGE_MAX_LENGTH, type TaskDetailDto } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { groupsQuery } from '@/features/groups/api';
import { ReviewDialog } from './review-dialog';

/**
 * "Generate tasks from text" (owner request 2026-10-21): a text typed or pasted on a task board,
 * then the same review as for a chat message (`ReviewDialog`, source `text`). On the global board
 * the person first picks the client (`pickGroup`); `groupId` preselects it. Lazy-loaded by
 * `GenerateTasksButton`.
 */
export function GenerateTasksDialog({
  groupId,
  pickGroup,
  onClose,
  onCreated,
}: {
  groupId: string | null;
  pickGroup: boolean;
  onClose: () => void;
  onCreated: (groupId: string, tasks: TaskDetailDto[]) => void;
}) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const groups = useQuery({ ...groupsQuery, enabled: pickGroup }).data;
  const clients = (groups ?? []).filter((g) => g.kind === 'client');
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState(groupId ?? '');
  const [reviewing, setReviewing] = useState(false);
  const target = pickGroup ? chosen : (groupId ?? '');
  const ready =
    text.trim() !== '' && (pickGroup ? clients.some((g) => g.id === target) : target !== '');

  if (reviewing && target !== '') {
    return (
      <ReviewDialog
        groupId={target}
        source={{ kind: 'text', groupId: target, text: text.trim() }}
        onClose={onClose}
        onCreated={(tasks) => onCreated(target, tasks)}
      />
    );
  }

  return (
    <SheetDialog onEscape={onClose} initialFocus={titleRef} testId="generate-tasks">
      <header className="px-4 pt-4 pb-3 min-[641px]:px-6 min-[641px]:pt-6">
        <SheetDialogTitle
          ref={titleRef}
          tabIndex={-1}
          className="text-medium font-semibold outline-none"
        >
          {t('taskSplit.fromText.title')}
        </SheetDialogTitle>
      </header>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) setReviewing(true);
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 min-[641px]:px-6">
          {pickGroup && (
            <label className="flex flex-col gap-1.5 text-button font-semibold">
              {t('taskSplit.fromText.client')}
              <Select
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                containerClassName="w-full"
              >
                <option value="" disabled>
                  {t('taskSplit.fromText.clientPlaceholder')}
                </option>
                {clients.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-button font-semibold">
            {t('taskSplit.fromText.text')}
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={10}
              placeholder={t('taskSplit.fromText.placeholder')}
              className="w-full resize-y rounded-md border-2 border-input bg-card px-[18px] py-[13px] text-button font-medium text-foreground placeholder:text-muted-foreground focus:border-foreground"
            />
          </label>
        </div>
        <footer className="flex justify-end gap-2 border-t-2 border-border px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] min-[641px]:px-6 min-[641px]:pb-4">
          <Button type="button" variant="outline" size="lg" className="px-5" onClick={onClose}>
            {t('taskSplit.cancel')}
          </Button>
          <Button type="submit" size="lg" className="px-5" disabled={!ready}>
            {t('taskSplit.fromText.generate')}
          </Button>
        </footer>
      </form>
    </SheetDialog>
  );
}

export default GenerateTasksDialog;
