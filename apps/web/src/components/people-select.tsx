import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isPickable, type GroupPerson, type TaskPerson } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CloseIcon } from '@/components/icons';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';

/** Stable defaults, so the memoized lists keep their identity across renders. */
const NONE: never[] = [];

type Candidate = {
  id: string;
  name: string;
  isAdmin: boolean;
  removed: boolean;
  /** Still a reader of the group, but no longer someone who can be picked. */
  notPickable: boolean;
};

/**
 * Searchable multi-select of at most `max` of the given `people` (undefined while they load).
 * Only pickable people are offered: the group's clients and its managers (`isPickable`).
 * Chosen people are removable chips, except those in `fixedIds`, which stay; people no longer in
 * the list (`knownPeople`) stay as "Name (removed)", and an eGrant admin who no longer manages
 * the group stays with a muted "not a manager", until the user removes them. `label` names the
 * list of suggestions. Needs the `forms` locale namespace.
 */
export function PeopleSelect({
  people,
  value,
  onChange,
  knownPeople = NONE,
  fixedIds = NONE,
  inputId,
  describedBy,
  invalid,
  max,
  label,
  pickable,
}: {
  people: GroupPerson[] | undefined;
  value: string[];
  onChange: (ids: string[]) => void;
  knownPeople?: TaskPerson[];
  /**
   * Chosen people who cannot be removed (such as the author). They must also be in `value`, and
   * the caller must keep them there: this field never removes them, but it does not add them.
   */
  fixedIds?: string[];
  inputId: string;
  describedBy?: string;
  invalid?: boolean;
  max: number;
  label: string;
  /**
   * Who can be picked, when not the group's clients and managers (`isPickable`): the ticket's
   * riešiteľ picker offers every admin.
   */
  pickable?: (person: GroupPerson) => boolean;
}) {
  const { t } = useTranslation();
  const me = useSession();
  const listId = useId();
  const hintId = `${listId}-hint`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const byId = useMemo(() => {
    const map = new Map<string, Candidate>();
    for (const p of knownPeople)
      map.set(p.id, { ...p, isAdmin: false, removed: true, notPickable: false });
    for (const p of people ?? [])
      map.set(p.id, { ...p, removed: false, notPickable: !(pickable ?? isPickable)(p) });
    return map;
  }, [people, knownPeople, pickable]);

  const full = value.length >= max;
  const options = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (people ?? []).filter(
      (p) =>
        (pickable ?? isPickable)(p) &&
        !value.includes(p.id) &&
        !fixedIds.includes(p.id) &&
        p.name.toLocaleLowerCase().includes(needle),
    );
  }, [people, value, fixedIds, query, pickable]);
  // An admin who does not manage the group cannot pick themselves: say who can be picked.
  const nonManagerAdmin =
    !pickable && !!people && isAdmin(me) && !people.some((p) => p.id === me?.id && p.isManager);
  const emptyLine =
    nonManagerAdmin && query.trim() === '' ? 'forms.people.noPickable' : 'forms.people.empty';
  const showList = open && !full;
  const activeIndex = Math.min(active, options.length - 1);

  const choose = (id: string) => {
    if (full || value.includes(id)) return;
    onChange([...value, id]);
    setQuery('');
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive(options.length ? (activeIndex + 1) % options.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActive(options.length ? (activeIndex - 1 + options.length) % options.length : 0);
    } else if (event.key === 'Enter' && showList) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option.id);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((id) => {
            const person = byId.get(id);
            const name = person?.name ?? '?';
            const chip = person?.removed ? t('forms.people.removed', { name }) : name;
            return (
              <li
                key={id}
                className="inline-flex max-w-full items-center gap-2 rounded-full bg-secondary py-1 pl-1 pr-2 text-tiny font-semibold"
              >
                <Avatar userId={id} name={name} size={20} />
                <span className="min-w-0 truncate">{chip}</span>
                {person?.isAdmin && <Badge variant="outline">{t('forms.people.adminPill')}</Badge>}
                {person?.notPickable && !fixedIds.includes(id) && (
                  <span className="shrink-0 font-normal text-neutral">
                    {t('forms.people.notManager')}
                  </span>
                )}
                {!fixedIds.includes(id) && (
                  <button
                    type="button"
                    aria-label={t('forms.people.remove', { name })}
                    onClick={() => onChange(value.filter((v) => v !== id))}
                    // A 16 px icon in a compact chip; the hit area around it is 44 px to tap.
                    data-hit
                    className="relative rounded-full before:absolute before:-inset-3.5 before:content-[''] hover:bg-surface-3"
                  >
                    <CloseIcon />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && options[activeIndex] ? `${listId}-${options[activeIndex].id}` : undefined
          }
          aria-describedby={
            [describedBy, full ? hintId : undefined].filter(Boolean).join(' ') || undefined
          }
          aria-invalid={invalid || undefined}
          autoComplete="off"
          readOnly={full}
          placeholder={t('forms.people.search')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {full && (
          <p id={hintId} className="mt-1.5 text-tiny text-muted-foreground">
            {t('forms.people.full', { max })}
          </p>
        )}
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          hidden={!showList}
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded-md border-2 border-border bg-popover py-1 shadow-lift"
        >
          {options.length === 0 && (
            <li className="px-4 py-2 text-tiny text-muted-foreground">{t(emptyLine)}</li>
          )}
          {options.map((p, index) => (
            <li
              key={p.id}
              id={`${listId}-${p.id}`}
              role="option"
              aria-selected={index === activeIndex}
              // mousedown keeps the input focused, so blur does not close the list first.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(p.id);
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2 px-3 py-2 text-button max-[640px]:min-h-11',
                index === activeIndex && 'bg-accent',
              )}
            >
              <Avatar userId={p.id} name={p.name} size={24} />
              <span className="min-w-0 truncate">{p.name}</span>
              {p.isAdmin && <Badge variant="outline">{t('forms.people.adminPill')}</Badge>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
