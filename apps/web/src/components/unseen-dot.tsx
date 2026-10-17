/**
 * The mark of a task or ticket with a change the viewer has not seen yet (2026-10-17): a small
 * ink dot before the title (the caller sets the title bold) and `label` ("Nová zmena") for
 * screen readers. Nothing when `unseen` is false.
 */
export function UnseenDot({ unseen, label }: { unseen: boolean; label: string }) {
  if (!unseen) return null;
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="unseen-dot"
        className="mr-1.5 inline-block size-2 shrink-0 rounded-full bg-primary align-middle"
      />
      <span className="sr-only">{label}: </span>
    </>
  );
}
