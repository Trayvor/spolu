import type { ReactNode } from 'react';

/** A 24 px outline glyph on the 24-unit grid. */
export function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const GROUPS = (
  <>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.8c1.8.7 3 2.4 3 5.2" />
  </>
);

/** Section key to glyph: the bottom bar's items and the section menu's sections. */
export const GLYPHS: Record<string, ReactNode> = {
  myGroups: GROUPS,
  group: GROUPS,
  home: <path d="M3 11 12 4l9 7M5 10v10h14V10" />,
  groups: GROUPS,
  tasks: <path d="M4 12.5 9 17.5 20 6.5" />,
  groupTasks: <path d="M4 12.5 9 17.5 20 6.5" />,
  tickets: (
    <path d="M4 8a2 2 0 0 0 0 4v0a2 2 0 0 0 0 4v2h16v-2a2 2 0 0 1 0-4 2 2 0 0 1 0-4V6H4zM14 6v12" />
  ),
  groupTickets: (
    <path d="M4 8a2 2 0 0 0 0 4v0a2 2 0 0 0 0 4v2h16v-2a2 2 0 0 1 0-4 2 2 0 0 1 0-4V6H4zM14 6v12" />
  ),
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  knowledge: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11" />,
  // Sections that only the section menu has (the bottom bar keeps them in "More").
  admins: (
    <>
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  bulkEmail: <path d="M3 6h18v12H3zM3 7l9 6 9-6" />,
  finance: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2-.4-2.5-1.2M12 6.5V8m0 8v1.5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
};
