import { useTranslation } from 'react-i18next';

/**
 * "Also from tasks and tickets": shown only while the "From chat" type is ticked. Unticked, the
 * list holds the group chat's files only.
 */
export function ChatsCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="inline-flex h-8 items-center gap-2 px-1 text-tiny font-semibold">
      <input
        type="checkbox"
        className="size-4 accent-foreground"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {t('knowledge.chat.alsoTasksTickets')}
    </label>
  );
}
