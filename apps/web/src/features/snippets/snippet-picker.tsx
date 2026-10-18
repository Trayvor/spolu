import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Snippet } from '@spolu/shared';
import { POPOVER } from '@/components/ui/popover';
import type { MentionPickerHandle } from '@/features/chat/mention-picker';
import { cn } from '@/lib/utils';
import { snippetsQuery } from './api';

export interface SnippetPickerProps {
  ref?: Ref<MentionPickerHandle>;
  /** What follows the `/`. */
  query: string;
  onPick(snippet: Snippet): void;
  onClose(): void;
  /** DOM id of the listbox (the field points at it with `aria-controls`). */
  id: string;
  onActiveChange?(optionId: string | undefined): void;
  /** Open below the field (the edit box) instead of above it. */
  below?: boolean;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Snippets whose title (first) or text contains `query`, diacritics-insensitive. */
function filterSnippets(snippets: Snippet[], query: string): Snippet[] {
  const needle = fold(query);
  if (needle === '') return snippets;
  const byTitle = snippets.filter((s) => fold(s.title).includes(needle));
  const byBody = snippets.filter((s) => !byTitle.includes(s) && fold(s.body).includes(needle));
  return [...byTitle, ...byBody];
}

const EXCERPT = 90;
const excerpt = (body: string) => {
  const line = body.replace(/\s+/g, ' ').trim();
  return line.length > EXCERPT ? `${line.slice(0, EXCERPT)}…` : line;
};

/**
 * F7: the list under a `/` in an admin's composer, the mention list's twin: the admin's canned
 * replies and the shared ones matching what follows the `/`, keys forwarded by the composer
 * (`handleKey`: arrows, Enter/Tab, Escape). Nothing shows when nothing matches, except right
 * after a bare `/` with no snippets at all, where it says where to add them. A lazy chunk with its
 * namespace `snippets`.
 */
export default function SnippetPicker({
  ref,
  query,
  onPick,
  onClose,
  id,
  onActiveChange,
  below = false,
}: SnippetPickerProps) {
  const { t } = useTranslation();
  const { data } = useQuery(snippetsQuery);
  const choices = useMemo(() => filterSnippets(data ?? [], query), [data, query]);
  const [raw, setRaw] = useState(0);
  const active = Math.min(raw, choices.length - 1);
  const optionId = (i: number) => `${id}-${i}`;

  useEffect(() => {
    if (choices.length === 0) return;
    onActiveChange?.(optionId(active));
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    return () => onActiveChange?.(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, id, choices.length]);

  useImperativeHandle(ref, () => ({
    handleKey(event) {
      if (choices.length === 0) return false;
      if (event.key === 'ArrowDown') setRaw((active + 1) % choices.length);
      else if (event.key === 'ArrowUp') setRaw((active - 1 + choices.length) % choices.length);
      else if (event.key === 'Enter' || event.key === 'Tab') onPick(choices[active]!);
      else if (event.key === 'Escape') onClose();
      else return false;
      event.preventDefault();
      return true;
    },
  }));

  const place = below ? 'top-full mt-1 origin-top' : 'bottom-full mb-1 origin-bottom';
  if (data === undefined) return null;
  if (data.length === 0) {
    if (query !== '') return null;
    return (
      <div
        className={cn(
          'absolute inset-x-0 z-10 animate-menu-in px-3 py-2 text-button',
          POPOVER,
          place,
        )}
      >
        <p className="text-muted-foreground">{t('snippets.picker.empty')}</p>
      </div>
    );
  }
  if (choices.length === 0) return null;
  return (
    <div
      className={cn(
        'absolute inset-x-0 z-10 flex max-h-[min(15rem,40dvh)] animate-menu-in flex-col',
        POPOVER,
        place,
      )}
    >
      <ul
        id={id}
        role="listbox"
        aria-label={t('snippets.picker.label')}
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        {choices.map((snippet, i) => (
          <li
            key={snippet.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            // mouseDown keeps the focus (and the caret) in the field.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(snippet);
            }}
            onMouseMove={() => setRaw(i)}
            className={cn(
              'flex cursor-pointer flex-col px-3 py-1.5 text-button max-[640px]:min-h-11',
              i === active && 'bg-accent',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 truncate font-semibold">{snippet.title}</span>
              {snippet.shared && (
                <span className="shrink-0 rounded-full bg-secondary px-2 text-nano font-semibold text-secondary-foreground">
                  {t('snippets.shared')}
                </span>
              )}
            </span>
            <span className="truncate text-micro text-muted-foreground">
              {excerpt(snippet.body)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
