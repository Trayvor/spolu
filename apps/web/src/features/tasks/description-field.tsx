import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { applyFormat, type FormatKind } from '@/features/chat/composer-text';
import { MessageBody } from '@/features/chat/format/render';
import { FormatToolbar, formatShortcut } from '@/features/chat/format-toolbar';
import { useGroupPeople } from '@/features/groups/use-group-people';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const MIN_ROWS = 12;

/**
 * The task description: the chat composer's formatting (toolbar, shortcuts, Markdown marks) on
 * a textarea at least 12 lines tall that grows with its text. A filled description is shown
 * rendered like a chat message until "Edit description"; leaving the field shows it rendered again.
 */
export function DescriptionField({
  id,
  groupId,
  value,
  onChange,
  error,
  errorId,
}: {
  id: string;
  groupId: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  errorId?: string;
}) {
  const { t } = useTranslation();
  const people = useGroupPeople(groupId).data;
  const nameOf = (userId: string) => people?.find((p) => p.id === userId)?.name;
  const [editing, setEditing] = useState(value.trim() === '');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const focusNext = useRef(false);
  const pendingSelection = useRef<[number, number] | null>(null);

  // Restore the selection after a toolbar edit, then grow the field with its text.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    if (focusNext.current) {
      focusNext.current = false;
      el.focus();
    }
    if (pendingSelection.current) {
      el.setSelectionRange(...pendingSelection.current);
      pendingSelection.current = null;
    }
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, editing]);

  function format(kind: FormatKind) {
    const el = textarea.current;
    if (!el) return;
    const next = applyFormat(value, el.selectionStart, el.selectionEnd, kind);
    pendingSelection.current = [next.start, next.end];
    onChange(next.value);
    el.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const kind = formatShortcut(e);
    if (!kind) return;
    e.preventDefault();
    format(kind);
  }

  // Focus moving out of the box (not to its toolbar) shows a filled description rendered.
  function onBlur(e: FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (value.trim() !== '' && !error) setEditing(false);
  }

  function edit() {
    focusNext.current = true;
    setEditing(true);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        {editing ? (
          <Label htmlFor={id}>{t('tasks.form.description')}</Label>
        ) : (
          <>
            <Label id={`${id}-label`}>{t('tasks.form.description')}</Label>
            <Button type="button" variant="ghost" size="sm" onClick={edit} className="h-6 px-2">
              {t('tasks.form.editDescription')}
            </Button>
          </>
        )}
      </div>
      {editing ? (
        <div
          onBlur={onBlur}
          className={cn(
            'rounded-md border-2 border-input bg-card focus-within:border-foreground',
            error && 'border-destructive',
          )}
        >
          <FormatToolbar onFormat={format} />
          <textarea
            ref={textarea}
            id={id}
            rows={MIN_ROWS}
            value={value}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            className="block w-full resize-none overflow-hidden rounded-b-md bg-transparent px-[18px] py-[13px] text-button font-medium text-foreground outline-none"
          />
        </div>
      ) : (
        <div
          role="group"
          aria-labelledby={`${id}-label`}
          className="rounded-md bg-card px-[18px] py-[13px] text-button"
        >
          <MessageBody body={value} nameOf={nameOf} />
        </div>
      )}
    </div>
  );
}
