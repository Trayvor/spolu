import { useTranslation } from 'react-i18next';
import type { Admin } from '@spolu/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const ALL = 'all';
const FIXED = ['all', 'me', 'none'] as const;

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * "Manager: …" on the Groups page, styled like the global board's filter pills (ink while a
 * filter is set): Everyone, Me, No manager, then every other active admin by name. `value` is
 * the `?manager=` param (undefined for Everyone); `admins` is null while they load.
 */
export function ManagerFilter({
  value,
  admins,
  meId,
  onChange,
}: {
  value: string | undefined;
  admins: Admin[] | null;
  meId: string;
  onChange: (next: string | undefined) => void;
}) {
  const { t, i18n } = useTranslation();
  const collator = new Intl.Collator(i18n.language);
  const others = (admins ?? [])
    .filter((a) => a.id !== meId)
    .sort((a, b) => collator.compare(a.name, b.name));
  const fixedName = (key: (typeof FIXED)[number]) => t(`groups.filter.${key}`);
  const current = value ?? ALL;
  const name =
    current === ALL || current === 'me' || current === 'none'
      ? fixedName(current)
      : (admins?.find((a) => a.id === current)?.name ?? '…');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className={cn(value && 'bg-primary text-primary-foreground hover:bg-ink-hover')}
        >
          {t('groups.filter.label', { name })}
          <Chevron />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(next) => onChange(next === ALL ? undefined : next)}
        >
          {FIXED.map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {fixedName(key)}
            </DropdownMenuRadioItem>
          ))}
          {others.length > 0 && <DropdownMenuSeparator />}
          {others.map((admin) => (
            <DropdownMenuRadioItem key={admin.id} value={admin.id}>
              {admin.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
