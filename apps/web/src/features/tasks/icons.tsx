import { Icon } from '@/components/icons';

export { CloseIcon, PaperclipIcon } from '@/components/icons';

/** A speech bubble; `unread` adds a filled dot at its top right corner. */
export const ChatIcon = ({ unread }: { unread?: boolean }) => (
  <span className="relative flex shrink-0">
    <Icon>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.6A8 8 0 1 1 21 12Z" />
    </Icon>
    {unread && (
      <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-foreground ring-2 ring-card" />
    )}
  </span>
);

export { MoreIcon } from '@/components/icons';

/** Six dots: the handle a custom bucket is dragged by. */
export const GripIcon = () => (
  <Icon>
    <circle cx="9" cy="6" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="18" r="1" />
  </Icon>
);
