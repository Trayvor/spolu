import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KnowledgeTypes, type KnowledgeType } from '@spolu/shared';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { BellIcon, FileIcon, LinkIcon, NoteIcon } from './icons';

const ICONS: Record<KnowledgeType, () => ReactNode> = {
  note: NoteIcon,
  file: FileIcon,
  link: LinkIcon,
  reminder: BellIcon,
};

const PlusIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width={16}
    height={16}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** The icon, the type's name and its help line. */
function Row({ type }: { type: KnowledgeType }) {
  const { t } = useTranslation();
  const Icon = ICONS[type];
  return (
    <>
      <span className="text-muted-foreground">
        <Icon />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-button font-semibold text-foreground">
          {t(`knowledge.types.${type}`)}
        </span>
        <span className="text-tiny text-muted-foreground">{t(`knowledge.newMenu.${type}`)}</span>
      </span>
    </>
  );
}

/**
 * The primary "+ New" pill and its menu of the four types, each with a line of help: the shared
 * dropdown from 641 px, an `ActionSheet` on phones.
 */
export function NewItemMenu({
  onPick,
  className,
}: {
  onPick: (type: KnowledgeType) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const desktop = useMediaQuery('(min-width: 641px)');
  const [sheetOpen, setSheetOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const button = (
    <Button ref={trigger} className={cn('gap-2', className)}>
      <PlusIcon />
      {t('knowledge.tab.new')}
    </Button>
  );

  if (desktop) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {KnowledgeTypes.map((type) => (
            <DropdownMenuItem key={type} onSelect={() => onPick(type)} className="gap-3 py-2">
              <Row type={type} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const close = () => {
    setSheetOpen(false);
    trigger.current?.focus();
  };
  return (
    <>
      <Button ref={trigger} className={cn('gap-2', className)} onClick={() => setSheetOpen(true)}>
        <PlusIcon />
        {t('knowledge.tab.new')}
      </Button>
      <ActionSheet open={sheetOpen} label={t('knowledge.newMenu.label')} onClose={close}>
        {KnowledgeTypes.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => {
              setSheetOpen(false);
              onPick(type);
            }}
            className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent"
          >
            <Row type={type} />
          </button>
        ))}
      </ActionSheet>
    </>
  );
}
