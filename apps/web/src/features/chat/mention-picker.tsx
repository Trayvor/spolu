import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupPerson } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { cn } from '@/lib/utils';

export type MentionChoice = { type: 'all' } | { type: 'person'; person: GroupPerson };

export interface MentionPickerHandle {
  /** Handles ArrowUp/Down, Enter/Tab and Escape; true when the key was used. */
  handleKey(event: KeyboardEvent): boolean;
}

interface MentionPickerProps {
  query: string;
  people: GroupPerson[];
  onPick(choice: MentionChoice): void;
  onClose(): void;
  /** DOM id of this listbox (the textarea points at it with `aria-controls`). */
  id: string;
  /** Reports the DOM id of the highlighted option for `aria-activedescendant`. */
  onActiveChange?(optionId: string | undefined): void;
  /**
   * Open below the field instead of above it. An edited message near the top of the list has no
   * room above (the list scroller clips it); below, the list simply scrolls.
   */
  below?: boolean;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** People whose name contains `query` (case- and diacritics-insensitive), sorted by name. */
export function filterPeople(people: GroupPerson[], query: string): GroupPerson[] {
  const needle = fold(query);
  return people
    .filter((p) => fold(p.name).includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const optionClass = 'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-button';

/**
 * The list under an `@` in the composer: "Everyone in this group" first, then matching people.
 * Focus stays in the textarea; the composer forwards keys to `handleKey`.
 */
export const MentionPicker = forwardRef<MentionPickerHandle, MentionPickerProps>(
  function MentionPicker(
    { query, people, onPick, onClose, id, onActiveChange, below = false },
    ref,
  ) {
    const { t } = useTranslation();
    const everyone = t('chat.mention.everyone');
    const choices = useMemo<MentionChoice[]>(() => {
      const list = filterPeople(people, query).map((person) => ({
        type: 'person' as const,
        person,
      }));
      // "Everyone" leads only while nothing is typed or the query (2+ letters) starts one of its
      // names, so a quick Enter after "@ja" or "@e" (aimed at Eva) never pings the whole group.
      const needle = fold(query);
      const everyoneMatches =
        needle.length === 0 ||
        (needle.length >= 2 &&
          ['all', 'everyone', everyone].some((label) => fold(label).startsWith(needle)));
      return everyoneMatches ? [{ type: 'all' as const }, ...list] : list;
    }, [people, query, everyone]);
    const [raw, setRaw] = useState(0);
    const active = Math.min(raw, choices.length - 1);
    const optionId = (i: number) => `${id}-${i}`;

    useEffect(() => {
      if (choices.length === 0) return;
      onActiveChange?.(optionId(active));
      document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
      return () => onActiveChange?.(undefined);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, id]);

    useImperativeHandle(ref, () => ({
      handleKey(event) {
        if (choices.length === 0) return false;
        if (event.key === 'ArrowDown') setRaw((active + 1) % choices.length);
        else if (event.key === 'ArrowUp') setRaw((active - 1 + choices.length) % choices.length);
        else if (event.key === 'Enter' || event.key === 'Tab')
          onPick(choices[active] as MentionChoice);
        else if (event.key === 'Escape') onClose();
        else return false;
        event.preventDefault();
        return true;
      },
    }));

    if (choices.length === 0) return null;
    return (
      <ul
        id={id}
        role="listbox"
        aria-label={t('chat.mention.label')}
        className={cn(
          'absolute inset-x-0 z-10 max-h-60 overflow-y-auto rounded-lg border border-border bg-card py-1',
          below ? 'top-full mt-1' : 'bottom-full mb-1',
        )}
      >
        {choices.map((choice, i) => (
          <li
            key={choice.type === 'all' ? 'all' : choice.person.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            // mouseDown keeps the focus (and the caret) in the textarea.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(choice);
            }}
            onMouseMove={() => setRaw(i)}
            className={cn(optionClass, i === active && 'bg-accent')}
          >
            {choice.type === 'all' ? (
              <span className="font-semibold">{t('chat.mention.everyone')}</span>
            ) : (
              <>
                <Avatar userId={choice.person.id} name={choice.person.name} size={24} />
                <span className="min-w-0 truncate">{choice.person.name}</span>
                {choice.person.isAdmin && (
                  <span className="rounded-full bg-secondary px-2 text-nano font-semibold text-secondary-foreground">
                    {t('chat.egrant')}
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    );
  },
);
