import type { ReactNode } from 'react';

function Tile({
  children,
  size = 18,
  name,
}: {
  children: ReactNode;
  size?: number;
  name?: string;
}) {
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
      data-icon={name}
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

export const NoteIcon = () => (
  <Tile name="note">
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

export const BellIcon = () => (
  <Tile name="bell">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />
  </Tile>
);

/** A meeting or call: a video camera. */
export const MeetingIcon = () => (
  <Tile name="meeting">
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-3v10l-5-3" />
  </Tile>
);

export const FolderIcon = () => (
  <Tile name="folder">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Tile>
);

/** The 12 px folder before a search result's folder path. */
export const SmallFolderIcon = () => (
  <Tile size={12}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Tile>
);

/** The 16 px chevron after a folder's name and between breadcrumbs. */
export const ChevronIcon = ({ size = 16 }: { size?: number }) => (
  <Tile size={size}>
    <path d="m9 6 6 6-6 6" />
  </Tile>
);

/** A chat file's tile: a speech bubble with a page in it. */
export const ChatFileIcon = () => (
  <Tile name="chat-file">
    <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4z" />
    <path d="M10 7h3l2 2v4h-5z" />
  </Tile>
);

/** The 12 px bubble before a chat file's source ("Group chat", "Task: …"). */
export const SmallChatIcon = () => (
  <Tile size={12}>
    <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4z" />
  </Tile>
);

/** The list view of the view toggle: three rows. */
export const ListViewIcon = () => (
  <Tile name="list-view">
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Tile>
);

/** The card view of the view toggle: four tiles. */
export const CardsViewIcon = () => (
  <Tile name="cards-view">
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </Tile>
);
