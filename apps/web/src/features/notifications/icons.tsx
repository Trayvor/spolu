import type { ReactNode } from 'react';

/** Outline bells for the three group modes (inline SVG, no icon library). */

function Bell({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      data-icon={name}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Everything notifies. */
export const BellIcon = () => (
  <Bell name="bell">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Bell>
);

/** Only mentions and replies: the bell with a small "@" on its body. */
export const BellAtIcon = () => (
  <Bell name="bell-at">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    <text
      x="12"
      y="13.5"
      textAnchor="middle"
      fontSize="9"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
    >
      @
    </text>
  </Bell>
);

/** Muted: the bell struck through. */
export const BellOffIcon = () => (
  <Bell name="bell-off">
    <path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5" />
    <path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    <path d="m2 2 20 20" />
  </Bell>
);
