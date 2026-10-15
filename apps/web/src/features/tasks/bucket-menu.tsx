import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreIcon } from './icons';

/** The "More" menu of a custom bucket (admins): Rename and Delete; the column does the rest inline. */
export function BucketMenu({
  title,
  onRename,
  onDelete,
}: {
  title: string;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const renaming = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${t('tasks.board.more')}: ${title}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent"
      >
        <MoreIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // After Rename the focus stays in the rename field; otherwise it returns to the trigger.
        onCloseAutoFocus={(event) => {
          if (renaming.current) event.preventDefault();
          renaming.current = false;
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            renaming.current = true;
            onRename();
          }}
        >
          {t('tasks.board.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} className="text-error-ink">
          {t('tasks.board.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
