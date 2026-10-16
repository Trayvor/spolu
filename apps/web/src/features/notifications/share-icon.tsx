/** The iOS Share glyph (a box with an arrow up out of it), so the step matches what Safari shows. */
export function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      data-testid="share-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 2.5v12.5M8 6.5l4-4 4 4" />
      <path d="M8.5 9.5H6.5a1.5 1.5 0 0 0-1.5 1.5v9a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-9a1.5 1.5 0 0 0-1.5-1.5h-2" />
    </svg>
  );
}
