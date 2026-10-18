import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QUICK_REACTIONS, type MessageDto, type Reaction } from '@spolu/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { reactionPeopleQuery, setReaction } from './api';

// The full picker (about 180 emoji) loads only when someone asks for more than the quick row.
const EmojiPickerSheet = lazy(() => import('./emoji-picker-sheet'));

/** A finger held this long on a chip shows who reacted instead of toggling. */
const PEEK_PRESS_MS = 450;

/** The reactions with the reader's own one turned on or off (the optimistic view of a tap). */
export function toggled(reactions: Reaction[], meId: string, emoji: string, on: boolean) {
  const at = reactions.findIndex((r) => r.emoji === emoji);
  if (on) {
    if (at === -1) return [...reactions, { emoji, userIds: [meId] }];
    const r = reactions[at]!;
    if (r.userIds.includes(meId)) return reactions;
    return reactions.map((x, i) => (i === at ? { ...x, userIds: [...x.userIds, meId] } : x));
  }
  if (at === -1) return reactions;
  return reactions
    .map((x, i) => (i === at ? { ...x, userIds: x.userIds.filter((id) => id !== meId) } : x))
    .filter((x) => x.userIds.length > 0);
}

/**
 * The reactions of a message as the reader sees them: the server's, or the reader's tap while it
 * is on its way. `toggle(emoji)` flips the reader's reaction; the answer goes to `onChanged`
 * (seq-neutral, like an edit), a failure puts the old state back.
 */
export function useReactions(
  message: MessageDto,
  meId: string,
  onChanged?: (message: MessageDto) => void,
) {
  // The optimistic state holds the server reactions it was made from: a newer server state
  // (event, catch-up, answer) replaces it on its own.
  const [pending, setPending] = useState<{ base: Reaction[]; value: Reaction[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const reactions =
    pending && pending.base === message.reactions ? pending.value : message.reactions;
  const latest = useRef({ message, reactions });
  useEffect(() => {
    latest.current = { message, reactions };
  });

  /** Flips the reader's reaction; `on` forces it (the full picker only adds). */
  const toggle = useCallback(
    (emoji: string, force?: boolean) => {
      const { message: m, reactions: now } = latest.current;
      const on = force ?? !now.some((r) => r.emoji === emoji && r.userIds.includes(meId));
      const value = toggled(now, meId, emoji, on);
      latest.current = { message: m, reactions: value };
      setPending({ base: m.reactions, value });
      setFailed(false);
      setReaction(m.id, emoji, on).then(
        (answer) => {
          const current = latest.current.message;
          if (answer.changeSeq > current.changeSeq && onChanged) {
            // The new message replaces the optimistic state (its reactions are a new base).
            onChanged({ ...current, reactions: answer.reactions, changeSeq: answer.changeSeq });
          } else {
            setPending(null);
          }
        },
        () => {
          setPending(null);
          setFailed(true);
        },
      );
    },
    [meId, onChanged],
  );
  return { reactions, toggle, failed };
}

const chip =
  'relative inline-flex h-7 items-center gap-1 rounded-full border px-2 text-micro font-semibold tabular-nums transition-colors duration-(--duration-fast) touch:h-9 touch:px-2.5';

/** Who added one emoji, loaded when the chip is hovered, focused or held. */
function WhoReacted({ message, emoji }: { message: MessageDto; emoji: string }) {
  const { t } = useTranslation();
  const { data, isError } = useQuery(reactionPeopleQuery(message.id, message.changeSeq));
  const names = data?.find((r) => r.emoji === emoji)?.people.map((p) => p.name);
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 w-max max-w-64 rounded-lg bg-popover px-2.5 py-1.5 text-left text-micro font-medium whitespace-normal text-popover-foreground shadow-lift"
    >
      {isError
        ? t('errors.generic')
        : names
          ? t('chat.reactions.who', { emoji, names: names.join(', ') })
          : t('chat.reactions.loading')}
    </span>
  );
}

function Chip({
  message,
  reaction,
  mine,
  onToggle,
}: {
  message: MessageDto;
  reaction: Reaction;
  mine: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const [peek, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const count = reaction.userIds.length;
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const onTouchStart = (event: TouchEvent) => {
    // The row's own long press (the action sheet) must not start from a chip.
    event.stopPropagation();
    held.current = false;
    clear();
    timer.current = setTimeout(() => {
      held.current = true;
      setPeek(true);
    }, PEEK_PRESS_MS);
  };
  const onTouchEnd = (event: TouchEvent) => {
    event.stopPropagation();
    clear();
    if (held.current) {
      // The finger lifting after a hold must not toggle; the names stay until the next tap.
      event.preventDefault();
      held.current = false;
      setTimeout(() => setPeek(false), 2000);
    }
  };
  return (
    <button
      type="button"
      aria-pressed={mine}
      aria-label={t(mine ? 'chat.reactions.chipMine' : 'chat.reactions.chip', {
        emoji: reaction.emoji,
        count,
      })}
      onClick={onToggle}
      onMouseEnter={() => setPeek(true)}
      onMouseLeave={() => setPeek(false)}
      onFocus={() => setPeek(true)}
      onBlur={() => setPeek(false)}
      onTouchStart={onTouchStart}
      onTouchMove={clear}
      onTouchEnd={onTouchEnd}
      onContextMenu={(event) => event.preventDefault()}
      data-hit=""
      className={cn(
        chip,
        mine
          ? 'border-brand-purple bg-brand-purple/10 text-brand-purple-ink'
          : 'border-transparent bg-secondary text-secondary-foreground hover:border-border',
      )}
    >
      <span aria-hidden="true" className="text-emoji-sm leading-none">
        {reaction.emoji}
      </span>
      <span aria-hidden="true">{count}</span>
      {peek && <WhoReacted message={message} emoji={reaction.emoji} />}
    </button>
  );
}

/** A smiling face with a plus: add a reaction. */
export const AddReactionIcon = () => (
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
    <path d="M20.9 13A9 9 0 1 1 11 3.1" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M16 5h6M19 2v6" />
  </svg>
);

/**
 * The quick row (👍 ❤️ 😂 😮 😢 🙏 ✅) and "More": the reader's own reactions are marked. Used
 * by the desktop menu and at the top of the phone action sheet.
 */
export function QuickReactions({
  reactions,
  meId,
  onPick,
  onMore,
  className,
}: {
  reactions: Reaction[];
  meId: string;
  onPick: (emoji: string) => void;
  onMore: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const mine = (emoji: string) =>
    reactions.some((r) => r.emoji === emoji && r.userIds.includes(meId));
  return (
    <div role="group" aria-label={t('chat.reactions.quick')} className={cn('flex', className)}>
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-pressed={mine(emoji)}
          aria-label={t('chat.reactions.react', { emoji })}
          onClick={() => onPick(emoji)}
          className={cn(
            'inline-flex size-11 items-center justify-center rounded-full text-emoji-lg leading-none hover:bg-accent focus-visible:bg-accent',
            mine(emoji) && 'bg-brand-purple/10',
          )}
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        aria-label={t('chat.reactions.more')}
        title={t('chat.reactions.more')}
        onClick={onMore}
        className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:bg-accent"
      >
        <AddReactionIcon />
      </button>
    </div>
  );
}

/** The full picker sheet, mounted while `open`. */
export function MorePicker({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <EmojiPickerSheet onPick={onPick} onClose={onClose} />
    </Suspense>
  );
}

/**
 * The desktop toolbar's "Add reaction": a menu with the quick row and "More emoji…", which opens
 * the full picker.
 */
export function ReactionMenu({
  reactions,
  meId,
  onPick,
  buttonClassName,
  icon,
}: {
  reactions: Reaction[];
  meId: string;
  /** `on` true: the full picker only adds. */
  onPick: (emoji: string, on?: boolean) => void;
  buttonClassName: string;
  icon: ReactNode;
}) {
  const { t } = useTranslation();
  const [more, setMore] = useState(false);
  const mine = (emoji: string) =>
    reactions.some((r) => r.emoji === emoji && r.userIds.includes(meId));
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('chat.reactions.add')}
            title={t('chat.reactions.add')}
            className={buttonClassName}
          >
            {icon}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-0 flex-row p-1"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {QUICK_REACTIONS.map((emoji) => (
            <DropdownMenuItem
              key={emoji}
              aria-label={t('chat.reactions.react', { emoji })}
              aria-checked={mine(emoji)}
              onSelect={() => onPick(emoji)}
              className={cn(
                'size-10 justify-center rounded-full p-0 text-emoji leading-none',
                mine(emoji) && 'bg-brand-purple/10',
              )}
            >
              {emoji}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            aria-label={t('chat.reactions.more')}
            onSelect={() => setMore(true)}
            className="size-10 justify-center rounded-full p-0 text-muted-foreground"
          >
            <AddReactionIcon />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <MorePicker
        open={more}
        onPick={(emoji) => {
          setMore(false);
          onPick(emoji, true);
        }}
        onClose={() => setMore(false)}
      />
    </>
  );
}

/** The chips under a message: emoji and count, mine highlighted, a tap toggles. */
export function ReactionChips({
  message,
  reactions,
  meId,
  onToggle,
  failed,
}: {
  message: MessageDto;
  reactions: Reaction[];
  meId: string;
  onToggle: (emoji: string) => void;
  failed: boolean;
}) {
  const { t } = useTranslation();
  if (reactions.length === 0 && !failed) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {reactions.map((r) => (
        <Chip
          key={r.emoji}
          message={message}
          reaction={r}
          mine={r.userIds.includes(meId)}
          onToggle={() => onToggle(r.emoji)}
        />
      ))}
      {failed && (
        <span role="alert" className="text-micro text-error-ink">
          {t('chat.reactions.failed')}
        </span>
      )}
    </div>
  );
}
