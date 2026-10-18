import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from 'radix-ui';
import type { GroupSummary } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';
import { useMediaQuery } from '@/lib/use-media-query';

/** `internal`: the admin group "eGrant tím" (Phase 34), the option at the top. */
export type ClientOption = { id: string; name: string; logoUrl: string | null; internal?: boolean };

/**
 * The filter's options from `/api/groups`: the client groups, and with `adminGroup` the admin
 * group first as the internal option (the global board and knowledge list); without it the admin
 * group is left out (lists where it can hold nothing, like tickets).
 */
export function toClientOptions(
  groups: readonly GroupSummary[],
  adminGroup: boolean,
): ClientOption[] {
  const option = (group: GroupSummary): ClientOption => ({
    id: group.id,
    name: group.name,
    logoUrl: group.hasLogo
      ? `/api/groups/${encodeURIComponent(group.id)}/logo?v=${encodeURIComponent(group.updatedAt)}`
      : null,
    ...(group.kind === 'admin' ? { internal: true } : {}),
  });
  const internal = adminGroup ? groups.filter((g) => g.kind === 'admin') : [];
  return [...internal, ...groups.filter((g) => g.kind === 'client')].map(option);
}

/** The 6 px ink dot of a client the viewer manages (chips, panel rows, picker results). */
export function ManagedDot() {
  return (
    <span
      data-managed-dot=""
      aria-hidden="true"
      className="size-1.5 shrink-0 rounded-full bg-foreground"
    />
  );
}

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

/**
 * The client's 24 px logo, or its first letter (drawn by CSS, so it is not part of the name); the
 * admin group without a logo shows the egrant mark.
 */
export function ClientLogo({ client }: { client: ClientOption }) {
  if (!client.logoUrl && client.internal) {
    return (
      <span
        aria-hidden="true"
        data-egrant-mark=""
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary"
      >
        <img src="/brand/favicon.svg" alt="" width={14} height={14} decoding="async" />
      </span>
    );
  }
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
 * - An `internal` option (the admin group, Phase 34) sits on top in its own section and belongs
 *   to the default scope with the managed clients (every admin is effectively its manager).
 * - Every change calls `onChange` at once with the ids in the order of `groups`; "Only my
 *   clients" and "Reset" give null, "All clients" every id.
 * - `defaultAll` (the admin group's attachment picker, Phase 34 part D): null is every client
 *   instead, so "Only my clients" gives the managed ids (and the internal option) and "Reset"
 *   null. The managed clients' rows carry the ink dot in the panel too.
 *
 * It renders the pill, the reset and the chip row as siblings: put it in a `flex flex-wrap` bar.
 * The reset ("Predvolené", `order-1`) lands after the bar's other controls; the chip row
 * (`order-last basis-full`, only with chips) wraps to its own line under the bar.
 */
export function ClientFilter({
  groups,
  managedIds,
  value,
  onChange,
  disabled = false,
  defaultAll = false,
}: {
  groups: ClientOption[];
  managedIds: string[] | null;
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  /** Disables the pill, for example until the groups and the managed ids have loaded. */
  disabled?: boolean;
  /** Null means every client, not the managed ones (the admin group's picker). */
  defaultAll?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const desktop = useMediaQuery('(min-width: 641px)');
  const [open, setOpen] = useState(false);

  const managed = useMemo(() => new Set(managedIds ?? []), [managedIds]);
  const sorted = useMemo(() => {
    const collator = new Intl.Collator(i18n.language);
    return [...groups].sort((a, b) => collator.compare(a.name, b.name));
  }, [groups, i18n.language]);
  const internal = sorted.filter((group) => group.internal);
  const mine = sorted.filter((group) => !group.internal && managed.has(group.id));
  const others = sorted.filter((group) => !group.internal && !managed.has(group.id));
  // Two sections only once the data says which clients are managed.
  const split = mine.length > 0;
  const mineScope = [...internal, ...mine];

  const defaultIds =
    split && !defaultAll ? mineScope.map((group) => group.id) : groups.map((group) => group.id);
  // Ids of clients that no longer exist (an old link, stored choice) are ignored.
  const known = new Set(groups.map((group) => group.id));
  const selected = new Set(value === null ? defaultIds : value.filter((id) => known.has(id)));
  const allChosen = groups.every((group) => selected.has(group.id));

  const pill =
    value === null
      ? split && !defaultAll
        ? t('knowledge.clientFilter.pillMine', { count: mine.length })
        : t('knowledge.clientFilter.pillAll')
      : allChosen
        ? t('knowledge.clientFilter.pillAll')
        : split &&
            selected.size === mineScope.length &&
            mineScope.every((group) => selected.has(group.id))
          ? t('knowledge.clientFilter.pillMine', { count: mine.length })
          : t('knowledge.clientFilter.pillSelected', { count: selected.size });

  const emit = (ids: Set<string>) =>
    onChange(groups.filter((group) => ids.has(group.id)).map((group) => group.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emit(next);
  };
  const chooseAll = () => emit(known);

  // Chips: the chosen clients, managed first, unless the choice is every client.
  const chips = allChosen
    ? []
    : [...internal, ...mine, ...others].filter((group) => selected.has(group.id));

  const panel = (
    <Panel
      internal={internal}
      mine={mine}
      others={others}
      split={split}
      showMineButton={managedIds !== null}
      noManaged={managedIds !== null && !split}
      selected={selected}
      onToggle={toggle}
      onOnlyMine={() => (defaultAll ? emit(new Set(mineScope.map((g) => g.id))) : onChange(null))}
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
      disabled={disabled}
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
              className="z-50 flex max-h-[min(520px,var(--radix-popover-content-available-height))] w-[360px] max-w-[calc(100vw-24px)] origin-(--radix-popover-content-transform-origin) flex-col rounded-xl bg-popover p-2 text-popover-foreground shadow-lift outline-none data-[state=closed]:animate-menu-out data-[state=open]:animate-menu-in"
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
              <div className="flex min-h-0 flex-1 flex-col p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
                <SheetDialogTitle className="pb-3 text-medium font-semibold">
                  {t('knowledge.clientFilter.title')}
                </SheetDialogTitle>
                {panel}
              </div>
            </SheetDialog>
          )}
        </>
      )}
      {chips.length > 0 && (
        <ul
          aria-label={t('knowledge.clientFilter.chosen')}
          className="order-last flex basis-full flex-wrap gap-2"
        >
          {chips.map((group) => (
            <li
              key={group.id}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary pr-1 pl-3 text-tiny font-semibold text-secondary-foreground"
            >
              {!group.internal && managed.has(group.id) && <ManagedDot />}
              <span className="max-w-[200px] truncate">{group.name}</span>
              <button
                type="button"
                aria-label={t('knowledge.clientFilter.remove', { name: group.name })}
                onClick={() => toggle(group.id)}
                className="relative inline-flex size-6 items-center justify-center rounded-full transition-colors duration-(--duration-fast) after:absolute after:-inset-2.5 hover:bg-surface-3"
              >
                <CrossIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      {value !== null && (
        <Button variant="link" size="sm" className="order-1" onClick={() => onChange(null)}>
          {t('knowledge.clientFilter.reset')}
        </Button>
      )}
    </>
  );
}

function Section({
  title,
  clients,
  selected,
  onToggle,
  managed = false,
}: {
  title: string;
  clients: ClientOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** The viewer's clients: each row carries the manager dot, as the chips do. */
  managed?: boolean;
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
          {managed && <ManagedDot />}
        </label>
      ))}
    </div>
  );
}

function Panel({
  internal,
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
  internal: ClientOption[];
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
  const shownInternal = match(internal);
  const shownMine = match(mine);
  const shownOthers = match(others);
  const internalSection = (
    <Section
      title={t('knowledge.clientFilter.internal')}
      clients={shownInternal}
      selected={selected}
      onToggle={onToggle}
    />
  );

  let sections: ReactNode;
  if (shownInternal.length + shownMine.length + shownOthers.length === 0) {
    sections = (
      <p className="px-3 py-2 text-button text-muted-foreground">
        {t('knowledge.clientFilter.noMatch', { q: find.trim() })}
      </p>
    );
  } else if (split) {
    sections = (
      <>
        {internalSection}
        <Section
          title={t('knowledge.clientFilter.managed')}
          clients={shownMine}
          selected={selected}
          onToggle={onToggle}
          managed
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
      <>
        {internalSection}
        <Section
          title={t('knowledge.clientFilter.clients')}
          clients={shownOthers}
          selected={selected}
          onToggle={onToggle}
        />
      </>
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
