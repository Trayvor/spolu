import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { applyFormat, type FormatKind } from '@/features/chat/composer-text';
import { MessageBody } from '@/features/chat/format/render';
import { FormatToolbar, formatShortcut } from '@/features/chat/format-toolbar';
import { useGroupPeople } from '@/features/groups/use-group-people';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const MIN_ROWS = 12;

/**
 * A long text with the chat composer's formatting (toolbar, shortcuts, Markdown marks) on a
 * textarea at least 12 lines tall that grows with its text, such as the task description. A
 * filled text is shown rendered like a chat message until `editLabel` ("Edit description") is
 * pressed; leaving the field shows it rendered again. Mentions are named from `groupId`'s people.
 * The toolbar's texts are in the `chat` locale namespace.
 */
export function FormattedTextField({
  id,
  groupId,
  value,
  onChange,
  label,
  editLabel,
  error,
  errorId,
}: {
  id: string;
  groupId: string;
  value: string;
  onChange: (next: string) => void;
  label: string;
  /** The button that switches a filled, rendered text back to editing. */
  editLabel: string;
  error?: string;
  errorId?: string;
}) {
  const people = useGroupPeople(groupId).data;
  const nameOf = (userId: string) => people?.find((p) => p.id === userId)?.name;
  const [editing, setEditing] = useState(value.trim() === '');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const focusNext = useRef(false);
  const pendingSelection = useRef<[number, number] | null>(null);
  // Read by the deferred blur check, which runs after the render it was scheduled in.
  const latest = useRef({ value, error });
  useEffect(() => {
    latest.current = { value, error };
  });

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

  // Focus leaving the box shows a filled description rendered. Decided a tick later, from where
  // the focus is then: Safari does not focus a clicked button, so its blur has no related target
  // even when the click goes to the toolbar (which hands the focus back to the textarea).
  function onBlur(e: FocusEvent<HTMLDivElement>) {
    const box = e.currentTarget;
    if (box.contains(e.relatedTarget as Node | null)) return;
    setTimeout(() => {
      if (box.isConnected && !box.contains(document.activeElement)) {
        if (latest.current.value.trim() !== '' && !latest.current.error) setEditing(false);
      }
    }, 0);
  }

  // A press on a toolbar button must not take the focus (and the selection) from the textarea.
  function keepFocus(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault();
  }

  function edit() {
    focusNext.current = true;
    setEditing(true);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        {editing ? (
          <Label htmlFor={id}>{label}</Label>
        ) : (
          <>
            <Label id={`${id}-label`}>{label}</Label>
            <Button type="button" variant="ghost" size="sm" onClick={edit} className="h-6 px-2">
              {editLabel}
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
          <div onMouseDown={keepFocus}>
            <FormatToolbar onFormat={format} />
          </div>
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
