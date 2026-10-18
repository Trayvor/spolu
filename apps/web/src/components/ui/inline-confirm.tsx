import { Button } from './button';

/**
 * The inline confirmation of a destructive action, in place of `window.confirm`: the question,
 * the destructive confirm button and a ghost Cancel, both `sm`, in one wrapping row (the button
 * rule in docs/design/tokens.md). Cancel takes the focus, so Enter does not destroy by accident.
 */
export function InlineConfirm({
  question,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  question: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="group" aria-label={question} className="flex flex-wrap items-center gap-2">
      <span className="text-tiny">{question}</span>
      <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" autoFocus data-cancel onClick={onCancel}>
        {cancelLabel}
      </Button>
    </div>
  );
}
