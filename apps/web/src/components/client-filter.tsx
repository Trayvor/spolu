import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { useMediaQuery } from '@/lib/use-media-query';

export type ClientOption = { id: string; name: string; logoUrl: string | null };

/** Lower case without diacritics, so "lu" finds "Lúčky". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** The client's 24 px logo, or its first letter (drawn by CSS, so it is not part of the name). */
function ClientLogo({ client }: { client: ClientOption }) {
  if (client.logoUrl) {
    return (
      <img
        src={client.logoUrl}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        className="size-6 shrink-0 rounded-md object-contain"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-letter={(Array.from(client.name.trim())[0] ?? '').toUpperCase()}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-micro font-semibold text-secondary-foreground before:content-[attr(data-letter)]"
    />
  );
}

/**
 * The client filter of the global lists (the knowledge list; the Phase 20 board reuses it): a
 * secondary pill that opens a popover from 641 px and a `SheetDialog` below, with a find field
 * and checkboxes, plus the chosen clients as removable chips.
 *
 * - `value` null is the default scope: the managed clients, or every client while `managedIds`
 *   is null (client managers do not exist) or empty (the admin manages none, with a hint).
 * - With managed clients the list splits into "Managed by you" and "Other clients"; managed
 *   chips carry a 6 px ink dot so the two kinds stay apart outside the popover too.
 * - Every change calls `onChange` at once with the ids in the order of `groups`; "Only my
 *   clients" and "Reset" give null.
 *
 * It renders the pill and the chip row side by side: put it in a `flex flex-wrap` bar, where the
 * chip row (`order-last basis-full`) wraps to its own line under the bar.
 */
export function ClientFilter({
  groups,
  managedIds,
  value,
  onChange,
}: {
  groups: ClientOption[];
  managedIds: string[] | null;
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const desktop = useMediaQuery('(min-width: 641px)');
  const [open, setOpen] = useState(false);

  const managed = useMemo(() => new Set(managedIds ?? []), [managedIds]);
  const sorted = useMemo(() => {
    const collator = new Intl.Collator(i18n.language);
    return [...groups].sort((a, b) => collator.compare(a.name, b.name));
  }, [groups, i18n.language]);
  const mine = sorted.filter((group) => managed.has(group.id));
  const others = sorted.filter((group) => !managed.has(group.id));
  // Two sections only once the data says which clients are managed.
  const split = mine.length > 0;

  const defaultIds = split ? mine.map((group) => group.id) : groups.map((group) => group.id);
  const selected = new Set(value ?? defaultIds);
  const allChosen = groups.every((group) => selected.has(group.id));

  const pill =
    value === null
      ? split
        ? t('knowledge.clientFilter.pillMine', { count: mine.length })
        : t('knowledge.clientFilter.pillAll')
      : allChosen
        ? t('knowledge.clientFilter.pillAll')
        : t('knowledge.clientFilter.pillSelected', { count: selected.size });

  const emit = (ids: Set<string>) =>
    onChange(groups.filter((group) => ids.has(group.id)).map((group) => group.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emit(next);
  };
  const chooseAll = () => (split ? emit(new Set(groups.map((group) => group.id))) : onChange(null));

  // Chips: the chosen clients, managed first, unless the choice is every client.
  const chips = allChosen ? [] : [...mine, ...others].filter((group) => selected.has(group.id));

  const panel = (
    <Panel
      mine={mine}
      others={others}
      split={split}
      showMineButton={managedIds !== null}
      noManaged={managedIds !== null && !split}
      selected={selected}
      onToggle={toggle}
      onOnlyMine={() => onChange(null)}
      onAll={chooseAll}
      onDone={() => setOpen(false)}
    />
  );

  const trigger = (
    <Button
      variant="secondary"
      size="sm"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={desktop ? undefined : () => setOpen(true)}
    >
      {pill}
      <ChevronIcon />
    </Button>
  );

  return (
    <>
      {desktop ? (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>{trigger}</Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={8}
              aria-label={t('knowledge.clientFilter.title')}
              className="z-50 flex max-h-[min(520px,var(--radix-popover-content-available-height))] w-[360px] max-w-[calc(100vw-24px)] flex-col rounded-xl bg-popover p-2 text-popover-foreground shadow-lift outline-none"
            >
              {panel}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        <>
          {trigger}
          {open && (
            <SheetDialog onEscape={() => setOpen(false)}>
              <div className="flex min-h-0 flex-1 flex-col p-4">
                <SheetDialogTitle className="pb-3 text-medium font-semibold">
                  {t('knowledge.clientFilter.title')}
                </SheetDialogTitle>
                {panel}
              </div>
            </SheetDialog>
          )}
        </>
      )}
      {(chips.length > 0 || value !== null) && (
        <div className="order-last flex basis-full flex-wrap items-center gap-2">
          {chips.length > 0 && (
            <ul aria-label={t('knowledge.clientFilter.chosen')} className="flex flex-wrap gap-2">
              {chips.map((group) => (
                <li
                  key={group.id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary pr-1 pl-3 text-tiny font-semibold text-secondary-foreground"
                >
                  {managed.has(group.id) && (
                    <span
                      data-managed-dot=""
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-foreground"
                    />
                  )}
                  <span className="max-w-[200px] truncate">{group.name}</span>
                  <button
                    type="button"
                    aria-label={t('knowledge.clientFilter.remove', { name: group.name })}
                    onClick={() => toggle(group.id)}
                    className="relative inline-flex size-6 items-center justify-center rounded-full transition-colors duration-(--duration-fast) after:absolute after:-inset-2 hover:bg-surface-3"
                  >
                    <CrossIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {value !== null && (
            <Button variant="link" size="sm" className="ml-auto" onClick={() => onChange(null)}>
              {t('knowledge.clientFilter.reset')}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function Section({
  title,
  clients,
  selected,
  onToggle,
}: {
  title: string;
  clients: ClientOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const id = useId();
  if (clients.length === 0) return null;
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col">
      <p id={id} className="px-3 pt-2 pb-1 text-micro font-semibold text-muted-foreground">
        {title}
      </p>
      {clients.map((client) => (
        <label
          key={client.id}
          className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-button font-medium transition-colors duration-(--duration-fast) hover:bg-accent max-[640px]:min-h-11"
        >
          <input
            type="checkbox"
            checked={selected.has(client.id)}
            onChange={() => onToggle(client.id)}
            className="size-5 shrink-0 accent-foreground"
          />
          <ClientLogo client={client} />
          <span className="min-w-0 truncate">{client.name}</span>
        </label>
      ))}
    </div>
  );
}

function Panel({
  mine,
  others,
  split,
  showMineButton,
  noManaged,
  selected,
  onToggle,
  onOnlyMine,
  onAll,
  onDone,
}: {
  mine: ClientOption[];
  others: ClientOption[];
  split: boolean;
  showMineButton: boolean;
  noManaged: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOnlyMine: () => void;
  onAll: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [find, setFind] = useState('');
  const needle = fold(find.trim());
  const match = (list: ClientOption[]) =>
    needle ? list.filter((client) => fold(client.name).includes(needle)) : list;
  const shownMine = match(mine);
  const shownOthers = match(others);

  let sections: ReactNode;
  if (shownMine.length + shownOthers.length === 0) {
    sections = (
      <p className="px-3 py-2 text-button text-muted-foreground">
        {t('knowledge.clientFilter.noMatch', { q: find.trim() })}
      </p>
    );
  } else if (split) {
    sections = (
      <>
        <Section
          title={t('knowledge.clientFilter.managed')}
          clients={shownMine}
          selected={selected}
          onToggle={onToggle}
        />
        <Section
          title={t('knowledge.clientFilter.others')}
          clients={shownOthers}
          selected={selected}
          onToggle={onToggle}
        />
      </>
    );
  } else {
    sections = (
      <Section
        title={t('knowledge.clientFilter.clients')}
        clients={shownOthers}
        selected={selected}
        onToggle={onToggle}
      />
    );
  }

  return (
    <>
      <Input
        type="search"
        value={find}
        onChange={(event) => setFind(event.target.value)}
        placeholder={t('knowledge.clientFilter.find')}
        aria-label={t('knowledge.clientFilter.find')}
        className="py-2"
      />
      {noManaged && (
        <p className="px-3 pt-3 text-tiny text-muted-foreground">
          {t('knowledge.clientFilter.noManaged')}
        </p>
      )}
      <div className="-mx-1 mt-1 min-h-0 flex-1 overflow-y-auto px-1 py-1">{sections}</div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        {showMineButton && (
          <Button variant="outline" size="sm" onClick={onOnlyMine}>
            {t('knowledge.clientFilter.onlyMine')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onAll}>
          {t('knowledge.clientFilter.allClients')}
        </Button>
        <Button size="sm" className="ml-auto" onClick={onDone}>
          {t('knowledge.clientFilter.done')}
        </Button>
      </div>
    </>
  );
}
