import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { FormatKind } from './composer-text';
import {
  BoldIcon,
  BulletListIcon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  NumberedListIcon,
  QuoteIcon,
  StrikeIcon,
} from './icons';

/** A 32 px icon button, as in the composer and its toolbar. */
export const iconButton =
  'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50';

/**
 * The same, 44 px on phones (a finger's size) with its focus ring drawn inside, as the row that
 * holds it scrolls sideways and would clip a ring outside.
 */
export const phoneIconButton = `${iconButton} shrink-0 max-[640px]:size-11 focus-visible:outline-offset-[-2px]`;

const FORMATS: { kind: FormatKind; key: string; icon: ReactNode; shortcut?: string }[] = [
  { kind: 'bold', key: 'bold', icon: <BoldIcon />, shortcut: 'B' },
  { kind: 'italic', key: 'italic', icon: <ItalicIcon />, shortcut: 'I' },
  { kind: 'strike', key: 'strike', icon: <StrikeIcon />, shortcut: 'Shift+X' },
  { kind: 'link', key: 'link', icon: <LinkIcon /> },
  { kind: 'bulletList', key: 'bulletList', icon: <BulletListIcon /> },
  { kind: 'numberedList', key: 'numberedList', icon: <NumberedListIcon /> },
  { kind: 'quote', key: 'quote', icon: <QuoteIcon /> },
  { kind: 'code', key: 'code', icon: <CodeIcon /> },
];

export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The format a key press asks for: Cmd (macOS, where Ctrl+B / Ctrl+I move the cursor) or Ctrl
 * (elsewhere) with B, I or Shift+X. Null for any other key.
 */
export function formatShortcut(e: KeyboardEvent): FormatKind | null {
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'b' && !e.shiftKey) return 'bold';
  if (key === 'i' && !e.shiftKey) return 'italic';
  if (key === 'x' && e.shiftKey) return 'strike';
  return null;
}

/**
 * The formatting toolbar of the chat composer: one button per Markdown mark, each named and
 * titled with its shortcut. Used by the composer and by the task description.
 *
 * The marks sit in an inner `toolbar` that scrolls sideways when the row is too narrow. `children`
 * are extra controls at the row's end (the composer's attach and Send); `className` places the row
 * (the default 1px line underneath, for a row above the field).
 */
export function FormatToolbar({
  onFormat,
  children,
  className,
}: {
  onFormat: (kind: FormatKind) => void;
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const modKey = isMac() ? 'Cmd+' : 'Ctrl+';
  return (
    <div className={cn('flex items-center gap-1 border-b border-border px-1.5 py-1', className)}>
      <div
        role="toolbar"
        aria-label={t('chat.composer.formatting')}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
      >
        {FORMATS.map(({ kind, key, icon, shortcut }) => {
          const label = t(`chat.format.${key}`);
          return (
            <button
              key={kind}
              type="button"
              aria-label={label}
              title={shortcut ? `${label} (${modKey}${shortcut})` : label}
              onClick={() => onFormat(kind)}
              className={phoneIconButton}
            >
              {icon}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
