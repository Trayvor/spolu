/** 16 px outline icons of the ticket screens (inline SVG, no icon library). */

export function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}

export function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function ChevronLeft() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M7.5 3 4.5 6l3 3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function LinkOutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M5 2.5H2.5v7h7V7M7 2.5h2.5V5M9.5 2.5 5.5 6.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

/** A thumb up (the "Helpful" rating, 2026-10-19). */
export function ThumbUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5 7v7H2.5V7H5Zm0 0 2.6-4.6a1.3 1.3 0 0 1 2.4.9L9.5 6h3.2a1.3 1.3 0 0 1 1.3 1.6l-1.1 5.3a1.4 1.4 0 0 1-1.4 1.1H5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A thumb down (the "Not helpful" rating, 2026-10-19). */
export function ThumbDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M11 9V2h2.5v7H11Zm0 0-2.6 4.6a1.3 1.3 0 0 1-2.4-.9l.5-2.7H3.3A1.3 1.3 0 0 1 2 8.4l1.1-5.3A1.4 1.4 0 0 1 4.5 2H11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
