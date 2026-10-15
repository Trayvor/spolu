import type { ReactNode } from 'react';

/** Small outline icons for the message toolbar (inline SVG, no icon library). */

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
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

/** A speech bubble: reply in a thread. */
export const ThreadIcon = () => (
  <Icon>
    <path d="M21 12a8 8 0 0 1-11.7 7.1L3 21l1.9-6.3A8 8 0 1 1 21 12z" />
  </Icon>
);

/** A turned arrow: reply to a message. */
export const ReplyIcon = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 6 6v3" />
  </Icon>
);

/** Three dots: more actions. */
export const MoreIcon = () => (
  <Icon>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </Icon>
);

/** Composer toolbar and file icons (same 16 px outline style). */
export const BoldIcon = () => (
  <Icon>
    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
  </Icon>
);
export const ItalicIcon = () => (
  <Icon>
    <path d="M19 4h-9M14 20H5M15 4 9 20" />
  </Icon>
);
export const StrikeIcon = () => (
  <Icon>
    <path d="M4 12h16M16 6.5A4 4 0 0 0 12 5c-2.5 0-4 1.2-4 3 0 1.2.8 2 2 2.5M8 17.5A4.5 4.5 0 0 0 12 19c2.5 0 4-1.2 4-3 0-.5-.1-.9-.4-1.3" />
  </Icon>
);
export const LinkIcon = () => (
  <Icon>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);
export const BulletListIcon = () => (
  <Icon>
    <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  </Icon>
);
export const NumberedListIcon = () => (
  <Icon>
    <path d="M10 6h10M10 12h10M10 18h10M4 5l1-1v4M4 14h2l-2 3h2" />
  </Icon>
);
export const QuoteIcon = () => (
  <Icon>
    <path d="M4 5v14M9 8h11M9 12h11M9 16h7" />
  </Icon>
);
export const CodeIcon = () => (
  <Icon>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
  </Icon>
);
export const PaperclipIcon = () => (
  <Icon>
    <path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

/** A left chevron: back to the chat. */
export const BackIcon = () => (
  <Icon>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);

/** A pencil: edit a message. */
export const EditIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
  </Icon>
);

/** A bin: delete a message. */
export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);
