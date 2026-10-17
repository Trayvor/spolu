import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { EditMode } from './phone-version';

const MODES: EditMode[] = ['computer', 'phone'];

/**
 * The Computer / Phone switch above the blocks (Phase 31, spec §4): it sets what the preview
 * shows and which version the blocks edit. Beside it, the state of the phone version and, when
 * it is edited separately, "Return to the computer version" (asks first).
 */
export function ModeBar({
  mode,
  onMode,
  separate,
  onReturn,
}: {
  mode: EditMode;
  onMode: (mode: EditMode) => void;
  separate: boolean;
  onReturn: () => void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-muted p-3 min-[641px]:flex-row min-[641px]:flex-wrap min-[641px]:items-center min-[641px]:gap-x-5">
      <div
        role="group"
        aria-label={t('bulkEmail.mode.label')}
        className="flex self-start rounded-full bg-secondary p-1"
      >
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => onMode(m)}
            className={cn(
              'h-8 rounded-full px-4 text-tiny font-semibold transition-colors duration-(--duration-fast) max-[640px]:h-11',
              mode === m ? 'bg-card shadow-lift' : 'hover:bg-surface-3',
            )}
          >
            {t(`bulkEmail.preview.${m}`)}
          </button>
        ))}
      </div>
      <p
        role="status"
        data-testid="phone-version-state"
        className="flex items-center gap-2 text-tiny font-semibold"
      >
        <span
          aria-hidden="true"
          className={cn('size-2.5 shrink-0 rounded-full', separate ? 'bg-attention' : 'bg-success')}
        />
        {t(separate ? 'bulkEmail.mode.separate' : 'bulkEmail.mode.follows')}
      </p>
      {!separate && mode === 'phone' && (
        <p className="text-micro text-muted-foreground min-[641px]:basis-full">
          {t('bulkEmail.mode.followsHint')}
        </p>
      )}
      {separate &&
        (confirm ? (
          <div className="flex flex-col gap-2 min-[641px]:basis-full min-[641px]:flex-row min-[641px]:items-center">
            <p className="text-button">{t('bulkEmail.mode.returnConfirm')}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => {
                  setConfirm(false);
                  onReturn();
                }}
              >
                {t('bulkEmail.mode.returnYes')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                {t('bulkEmail.editor.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={() => setConfirm(true)}>
            {t('bulkEmail.mode.return')}
          </Button>
        ))}
    </div>
  );
}
