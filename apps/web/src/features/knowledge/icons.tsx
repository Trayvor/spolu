import type { ReactNode } from 'react';

function Tile({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

export const NoteIcon = () => (
  <Tile>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Tile>
);

export const FileIcon = () => (
  <Tile>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Tile>
);

export const LinkIcon = () => (
  <Tile>
    <path d="M7 17 17 7M8 7h9v9" />
  </Tile>
);

/** The 12 px arrow-out beside a link's URL. */
export const ArrowOutIcon = () => (
  <Tile size={12}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Tile>
);

export const LockIcon = () => (
  <Tile size={12}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Tile>
);
