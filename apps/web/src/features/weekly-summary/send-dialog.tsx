import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SheetDialog, SheetDialogTitle } from '@/components/ui/sheet-dialog';

/** "Poslať prehľad 4 príjemcom?": a sent email cannot be changed, so it asks first. */
export function SendDialog({
  count,
  busy,
  onConfirm,
  onClose,
}: {
  count: number;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <SheetDialog onEscape={onClose} compact testId="weekly-send">
      <div className="flex flex-col gap-4 p-6">
        <SheetDialogTitle className="text-body font-semibold">
          {t('weeklySummary.send.question', { count })}
        </SheetDialogTitle>
        <p className="text-button text-muted-foreground">{t('weeklySummary.send.final')}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={onConfirm}>
            {t('weeklySummary.send.confirm')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('weeklySummary.send.cancel')}
          </Button>
        </div>
      </div>
    </SheetDialog>
  );
}
