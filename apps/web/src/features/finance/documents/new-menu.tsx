import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FinanceItemTypes, type FinanceItemType } from '@spolu/shared';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileIcon, FolderIcon, NoteIcon } from '@/features/knowledge/icons';
import { useMediaQuery } from '@/lib/use-media-query';
import { ContractIcon } from './icons';

export const KIND_ICONS: Record<FinanceItemType, () => ReactNode> = {
  contract: ContractIcon,
  document: FileIcon,
  note: NoteIcon,
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

type Kind = FinanceItemType | 'folder';

function Row({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  const Glyph = kind === 'folder' ? FolderIcon : KIND_ICONS[kind];
  return (
    <>
      <span className="text-muted-foreground">
        <Glyph />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-button font-semibold text-foreground">
          {t(`financeDocuments.kinds.${kind}`)}
        </span>
        <span className="text-tiny text-muted-foreground">
          {t(`financeDocuments.kindsHelp.${kind}`)}
        </span>
      </span>
    </>
  );
}

/**
 * "+ New" with the four kinds of the finance Documents card (spec §6.1): Contract, Document,
 * Note, and after a rule Folder. The shared dropdown from 641 px, an `ActionSheet` on phones.
 */
export function NewMenu({
  onPick,
  onPickFolder,
}: {
  onPick: (type: FinanceItemType) => void;
  onPickFolder: () => void;
}) {
  const { t } = useTranslation();
  const desktop = useMediaQuery('(min-width: 641px)');
  const [sheetOpen, setSheetOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = (
    <>
      <PlusIcon />
      {t('financeDocuments.card.new')}
    </>
  );

  if (desktop) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} size="sm" className="gap-2">
            {label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {FinanceItemTypes.map((type) => (
            <DropdownMenuItem key={type} onSelect={() => onPick(type)} className="gap-3 py-2">
              <Row kind={type} />
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onPickFolder} className="gap-3 py-2">
            <Row kind="folder" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const pick = (run: () => void) => {
    setSheetOpen(false);
    run();
  };
  return (
    <>
      <Button ref={trigger} size="sm" className="gap-2" onClick={() => setSheetOpen(true)}>
        {label}
      </Button>
      <ActionSheet
        open={sheetOpen}
        label={t('financeDocuments.card.newLabel')}
        onClose={() => {
          setSheetOpen(false);
          trigger.current?.focus();
        }}
      >
        {FinanceItemTypes.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => pick(() => onPick(type))}
            className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent"
          >
            <Row kind={type} />
          </button>
        ))}
        <button
          type="button"
          onClick={() => pick(onPickFolder)}
          className="flex min-h-14 w-full items-center gap-3 rounded-lg border-t-2 border-border px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent"
        >
          <Row kind="folder" />
        </button>
      </ActionSheet>
    </>
  );
}
