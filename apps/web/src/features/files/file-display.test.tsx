import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FileInfo } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { FileChip } from './file-chip';
import { ImagePreview } from './image-preview';

const DOC: FileInfo = {
  id: 'f 1',
  name: 'Report 2026.pdf',
  mime: 'application/pdf',
  size: 1536,
  width: null,
  height: null,
  hasPreview: false,
};
const IMG: FileInfo = {
  ...DOC,
  id: 'f2',
  name: 'photo.jpg',
  mime: 'image/jpeg',
  size: 2_000_000,
  width: 1600,
  height: 900,
  hasPreview: true,
};

describe('file display', () => {
  it('FileChip links to /api/files/<id> with download and shows name and size', async () => {
    await setLanguage('en');
    render(<FileChip file={DOC} />);
    const link = screen.getByRole('link', { name: i18n.t('files.download', { name: DOC.name }) });
    expect(link).toHaveAttribute('href', '/api/files/f%201');
    expect(link).toHaveAttribute('download');
    expect(screen.getByText('Report 2026.pdf')).toHaveAttribute('title', 'Report 2026.pdf');
    expect(screen.getByText(/1\.5\s*kB/)).toBeInTheDocument();
  });

  it('ImagePreview renders the preview with the aspect ratio and opens the full file in a new tab', async () => {
    await setLanguage('en');
    const { container } = render(<ImagePreview file={IMG} maxWidth={200} />);
    const link = screen.getByRole('link', { name: i18n.t('files.openImage', { name: IMG.name }) });
    expect(link).toHaveAttribute('href', '/api/files/f2');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.style.aspectRatio).toBe('1600 / 900');
    expect(link.style.width).toBe('min(100%, 200px)');
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', '/api/files/f2/preview');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('ImagePreview never upscales beyond the natural width', async () => {
    await setLanguage('en');
    render(<ImagePreview file={{ ...IMG, width: 120, height: 80 }} maxWidth={320} />);
    const link = screen.getByRole('link', { name: i18n.t('files.openImage', { name: IMG.name }) });
    expect(link.style.width).toBe('min(100%, 120px)');
  });

  it('ImagePreview without a preview falls back to FileChip', async () => {
    await setLanguage('en');
    render(<ImagePreview file={{ ...IMG, hasPreview: false }} />);
    expect(
      screen.getByRole('link', { name: i18n.t('files.download', { name: IMG.name }) }),
    ).toHaveAttribute('download');
  });
});
