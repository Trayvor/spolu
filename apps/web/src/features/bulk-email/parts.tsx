import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BulkCampaignStatus } from '@spolu/shared';
import { Badge } from '@/components/ui/badge';

const STATUS_VARIANT = {
  draft: 'secondary',
  sending: 'default',
  sent: 'success',
  cancelled: 'outline',
} as const;

export function StatusBadge({ status }: { status: BulkCampaignStatus }) {
  const { t } = useTranslation();
  return <Badge variant={STATUS_VARIANT[status]}>{t(`bulkEmail.status.${status}`)}</Badge>;
}

/** `value`, once it stayed the same for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** "16 Oct 2026, 14:05" in the UI language. */
export function formatDateTime(iso: string, language: string): string {
  let format = dateFormats.get(language);
  if (!format) {
    format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    dateFormats.set(language, format);
  }
  return format.format(new Date(iso));
}

/** A field's hint or problem line under it. */
export function FieldNote({
  id,
  error,
  children,
}: {
  id?: string;
  error?: boolean;
  children: string;
}) {
  return (
    <p id={id} className={error ? 'text-micro text-error-ink' : 'text-micro text-muted-foreground'}>
      {children}
    </p>
  );
}
