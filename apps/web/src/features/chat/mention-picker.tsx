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
  function MentionPicker({ query, people, onPick, onClose, id, onActiveChange }, ref) {
    const { t } = useTranslation();
    const choices = useMemo<MentionChoice[]>(
      () => [
        { type: 'all' },
        ...filterPeople(people, query).map((person) => ({ type: 'person' as const, person })),
      ],
      [people, query],
    );
    const [raw, setRaw] = useState(0);
    const active = Math.min(raw, choices.length - 1);
    const optionId = (i: number) => `${id}-${i}`;

    useEffect(() => {
      onActiveChange?.(optionId(active));
      return () => onActiveChange?.(undefined);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, id]);

    useImperativeHandle(ref, () => ({
      handleKey(event) {
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

    return (
      <ul
        id={id}
        role="listbox"
        aria-label={t('chat.mention.label')}
        className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-card py-1"
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
