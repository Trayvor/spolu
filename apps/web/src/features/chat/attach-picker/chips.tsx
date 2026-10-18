import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { BookIcon, CloseIcon } from '../icons';
import type { Picked } from './picked';

type Kind = keyof Picked;

function Chip({
  mark,
  label,
  removeLabel,
  onRemove,
}: {
  mark: React.ReactNode;
  label: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <li className="flex max-w-full items-center gap-2 rounded-lg bg-secondary py-1 pl-3 pr-1 text-button text-secondary-foreground">
      <span className="shrink-0 font-semibold text-brand-purple-ink">{mark}</span>
      <span title={label} className="min-w-0 truncate font-semibold">
        {label}
      </span>
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent',
          'max-[640px]:size-11',
        )}
      >
        <CloseIcon />
      </button>
    </li>
  );
}

/**
 * The picked tasks and tickets as removable chips, in the composer and (with knowledge too, from
 * all three tabs) at the bottom of the attachment picker. Nothing when nothing is picked.
 */
export function PickedChips({
  picked,
  onRemove,
  kinds,
}: {
  picked: Picked;
  onRemove: (kind: Kind, id: string) => void;
  kinds: readonly Kind[];
}) {
  const { t } = useTranslation();
  const chips = [
    ...(kinds.includes('knowledge') ? picked.knowledge : []).map((k) => (
      <Chip
        key={`k${k.id}`}
        mark={<BookIcon />}
        label={k.title}
        removeLabel={t('chat.knowledge.remove', { title: k.title })}
        onRemove={() => onRemove('knowledge', k.id)}
      />
    )),
    ...(kinds.includes('tasks') ? picked.tasks : []).map((k) => (
      <Chip
        key={`t${k.id}`}
        mark={<span aria-hidden="true">✓</span>}
        label={k.title}
        removeLabel={t('chat.knowledge.remove', { title: k.title })}
        onRemove={() => onRemove('tasks', k.id)}
      />
    )),
    ...(kinds.includes('tickets') ? picked.tickets : []).map((k) => {
      const label = k.subject ? `${k.number} ${k.subject}` : String(k.number);
      return (
        <Chip
          key={`s${k.id}`}
          mark={<span aria-hidden="true">#</span>}
          label={label}
          removeLabel={t('chat.knowledge.remove', { title: label })}
          onRemove={() => onRemove('tickets', k.id)}
        />
      );
    }),
  ];
  if (chips.length === 0) return null;
  return (
    <ul role="list" className="flex flex-wrap gap-2" aria-label={t('chat.work.attached')}>
      {chips}
    </ul>
  );
}
