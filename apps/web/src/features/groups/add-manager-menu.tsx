import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupPerson } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

/** Over this many candidates the menu gets a find field. */
const FIND_FROM = 9;

/** Lower case without diacritics, so "luc" finds "Lúčka". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * "+ Add manager" on the Members tab (admins): a menu of the active admins who do not manage
 * the group yet, by name, with a find field when there are more than 8. `people` is the group's
 * people (`useGroupPeople`), which lists every active admin with `isManager`.
 */
export function AddManagerMenu({
  people,
  disabled,
  onPick,
}: {
  people: GroupPerson[];
  disabled: boolean;
  onPick: (userId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [find, setFind] = useState('');
  const candidates = useMemo(() => {
    const collator = new Intl.Collator(i18n.language);
    return people
      .filter((p) => p.isAdmin && !p.isManager)
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [people, i18n.language]);
  const needle = fold(find.trim());
  const shown = needle ? candidates.filter((p) => fold(p.name).includes(needle)) : candidates;

  return (
    <DropdownMenu onOpenChange={(open) => !open && setFind('')}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled}>
          <PlusIcon />
          {t('groups.managers.add')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-[280px]">
        {candidates.length >= FIND_FROM && (
          <Input
            type="search"
            value={find}
            onChange={(event) => setFind(event.target.value)}
            // The menu's typeahead would take the letters; Escape still closes it.
            onKeyDown={(event) => event.key !== 'Escape' && event.stopPropagation()}
            placeholder={t('groups.managers.find')}
            aria-label={t('groups.managers.find')}
            className="mb-1 py-2"
          />
        )}
        {candidates.length === 0 && (
          <p className="px-3 py-2 text-button text-muted-foreground">
            {t('groups.managers.allAdded')}
          </p>
        )}
        {candidates.length > 0 && shown.length === 0 && (
          <p className="px-3 py-2 text-button text-muted-foreground">
            {t('groups.managers.noMatch', { q: find.trim() })}
          </p>
        )}
        {shown.map((person) => (
          <DropdownMenuItem key={person.id} onSelect={() => onPick(person.id)}>
            <span className="min-w-0 truncate">{person.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
