import { useTranslation } from 'react-i18next';
import { useNamespaces } from '@/i18n/namespaces';

/**
 * The strip announcing a planned outage, under the header like the offline strip. A lazy chunk
 * with its own texts, loaded only while an outage is ahead (`maintenance.ts`). The time is shown
 * in Bratislava time, the one the team announces it in, and says so.
 */
export function MaintenanceStrip({ at }: { at: Date }) {
  useNamespaces(['maintenance']);
  const { t, i18n } = useTranslation();
  const when = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Bratislava',
  }).format(at);
  return (
    <p
      role="status"
      className="mx-auto mt-2 w-full max-w-[1600px] rounded-lg bg-attention px-4 py-2 text-center text-tiny font-semibold text-attention-foreground"
    >
      {t('maintenance.notice', { when })}
    </p>
  );
}
