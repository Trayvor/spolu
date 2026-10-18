import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BULK_PEOPLE_SEARCH, type BulkPerson } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { CloseIcon } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { peopleSearchQuery } from './api';
import { useDebounced } from './parts';

/**
 * Hand-picked people: chips of the chosen ones (names from `known`, the email while unknown)
 * and a search by name or email (from 2 characters, 300 ms after typing, 20 results).
 */
export function PersonPicker({
  label,
  ids,
  known,
  onAdd,
  onRemove,
}: {
  label: string;
  ids: string[];
  known: ReadonlyMap<string, BulkPerson>;
  onAdd: (person: BulkPerson) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const searching = q.length >= BULK_PEOPLE_SEARCH.minQuery;
  const results = useQuery({ ...peopleSearchQuery(q), enabled: searching });
  const chosen = new Set(ids);
  const offered = (results.data ?? []).filter((p) => !chosen.has(p.id));

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      {ids.length > 0 && (
        <ul role="list" className="flex flex-wrap gap-2" aria-label={label}>
          {ids.map((id) => {
            const person = known.get(id);
            const name = person?.name || person?.email || t('bulkEmail.picker.unknown');
            return (
              <li
                key={id}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary py-1 pr-1 pl-3 text-tiny font-semibold"
              >
                <span className="truncate">{name}</span>
                <button
                  type="button"
                  aria-label={t('bulkEmail.picker.remove', { name })}
                  className="relative inline-flex size-6 items-center justify-center rounded-full after:absolute after:-inset-2.5 after:content-[''] hover:bg-surface-3"
                  onClick={() => onRemove(id)}
                >
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Input
        id={inputId}
        type="search"
        autoComplete="off"
        placeholder={t('bulkEmail.picker.search')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {text.trim().length > 0 && !searching && text.trim().length < BULK_PEOPLE_SEARCH.minQuery && (
        <p className="text-micro text-muted-foreground">{t('bulkEmail.picker.min')}</p>
      )}
      {searching && results.isSuccess && offered.length === 0 && (
        <p className="text-micro text-muted-foreground">{t('bulkEmail.picker.none')}</p>
      )}
      {searching && offered.length > 0 && (
        <ul
          role="list"
          className="flex max-h-[240px] flex-col overflow-y-auto rounded-md border-2 border-border bg-card"
        >
          {offered.map((person) => (
            <li
              key={person.id}
              className="flex items-center gap-3 px-3 py-2 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-button font-semibold">
                  {person.name || person.email}
                </div>
                <div className="truncate text-micro text-muted-foreground">{person.email}</div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={t('bulkEmail.picker.add', { name: person.name || person.email })}
                onClick={() => {
                  onAdd(person);
                  setText('');
                }}
              >
                {t('bulkEmail.picker.addShort')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
