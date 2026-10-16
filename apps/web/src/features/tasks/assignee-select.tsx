import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isPickable, type TaskPerson } from '@spolu/shared';
import { Avatar } from '@/components/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { isAdmin } from '@/features/auth/roles';
import { useSession } from '@/features/auth/use-session';
import { useGroupPeople } from '@/features/groups/use-group-people';
import { CloseIcon } from './icons';

export const MAX_ASSIGNEES = 10;

type Candidate = {
  id: string;
  name: string;
  isAdmin: boolean;
  removed: boolean;
  /** Still a reader of the group, but no longer someone who can be assigned. */
  notPickable: boolean;
};

/**
 * Searchable multi-select over the people who can be assigned: the group's clients and its
 * managers (`isPickable`). Chosen people are removable chips; people who left the group
 * (`knownPeople`) stay as "Name (removed)", and an eGrant admin who no longer manages the group
 * stays with a muted "not a manager", until the user removes them.
 */
export function AssigneeSelect({
  groupId,
  value,
  onChange,
  knownPeople = [],
  inputId,
  describedBy,
  invalid,
}: {
  groupId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  knownPeople?: TaskPerson[];
  inputId: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const people = useGroupPeople(groupId).data;
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
      map.set(p.id, { ...p, removed: false, notPickable: !isPickable(p) });
    return map;
  }, [people, knownPeople]);

  const full = value.length >= MAX_ASSIGNEES;
  const options = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (people ?? []).filter(
      (p) => isPickable(p) && !value.includes(p.id) && p.name.toLocaleLowerCase().includes(needle),
    );
  }, [people, value, query]);
  // An admin who does not manage the group cannot assign themselves: say who can be assigned.
  const nonManagerAdmin =
    !!people && isAdmin(me) && !people.some((p) => p.id === me?.id && p.isManager);
  const emptyLine =
    nonManagerAdmin && query.trim() === '' ? 'tasks.form.noPickablePeople' : 'tasks.form.noPeople';
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
            const label = person?.removed ? t('tasks.form.removedPerson', { name }) : name;
            return (
              <li
                key={id}
                className="inline-flex max-w-full items-center gap-2 rounded-full bg-secondary py-1 pl-1 pr-2 text-tiny font-semibold"
              >
                <Avatar userId={id} name={name} size={20} />
                <span className="min-w-0 truncate">{label}</span>
                {person?.isAdmin && <Badge variant="outline">{t('tasks.form.adminPill')}</Badge>}
                {person?.notPickable && (
                  <span className="shrink-0 font-normal text-muted-foreground">
                    {t('tasks.assignee.notManager')}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={t('tasks.form.remove', { name })}
                  onClick={() => onChange(value.filter((v) => v !== id))}
                  // A 16 px icon in a compact chip; the hit area around it is 44 px to tap.
                  data-hit
                  className="relative rounded-full before:absolute before:-inset-3.5 before:content-[''] hover:bg-surface-3"
                >
                  <CloseIcon />
                </button>
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
          placeholder={t('tasks.form.searchPeople')}
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
            {t('tasks.form.errors.tooManyAssignees')}
          </p>
        )}
        <ul
          id={listId}
          role="listbox"
          aria-label={t('tasks.form.assignees')}
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
                'flex cursor-pointer items-center gap-2 px-3 py-2 text-button',
                index === activeIndex && 'bg-accent',
              )}
            >
              <Avatar userId={p.id} name={p.name} size={24} />
              <span className="min-w-0 truncate">{p.name}</span>
              {p.isAdmin && <Badge variant="outline">{t('tasks.form.adminPill')}</Badge>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
