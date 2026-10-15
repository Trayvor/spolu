import type { FileInfo } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatFileSize } from './format-size';
import { fileUrl } from './urls';

/** One row: document icon, name (truncated) and size. The whole chip downloads the file. */
export function FileChip({ file, className }: { file: FileInfo; className?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <a
      href={fileUrl(file.id)}
      download
      aria-label={t('files.download', { name: file.name })}
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-button text-secondary-foreground hover:bg-surface-3 hover:text-secondary-foreground',
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
      </svg>
      <span title={file.name} className="min-w-0 truncate font-semibold">
        {file.name}
      </span>
      <span className="shrink-0 text-micro text-muted-foreground">
        {formatFileSize(file.size, i18n.language)}
      </span>
    </a>
  );
}
