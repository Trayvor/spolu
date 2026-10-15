import type { FileInfo } from '@spolu/shared';
import { useTranslation } from 'react-i18next';
import { FileChip } from './file-chip';
import { fileUrl, previewUrl } from './urls';

/**
 * The 640 px preview in a box with the image's aspect ratio (no layout jump while it loads);
 * a click opens the full file in a new tab. Without a preview it is a FileChip.
 */
export function ImagePreview({ file, maxWidth = 320 }: { file: FileInfo; maxWidth?: number }) {
  const { t } = useTranslation();
  if (!file.hasPreview || !file.width || !file.height) return <FileChip file={file} />;
  return (
    <a
      href={fileUrl(file.id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('files.openImage', { name: file.name })}
      className="block overflow-hidden rounded-lg bg-muted"
      style={{
        aspectRatio: `${file.width} / ${file.height}`,
        maxWidth: `min(100%, ${maxWidth}px)`,
      }}
    >
      <img
        src={previewUrl(file.id)}
        alt=""
        loading="lazy"
        decoding="async"
        className="block h-full w-full object-cover"
      />
    </a>
  );
}
