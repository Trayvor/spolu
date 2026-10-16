import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { FileInfo } from '@spolu/shared';
import { uploadFile } from '@/features/files/upload';
import { FilesField } from './files-field';

vi.mock('@/features/files/upload', () => ({ uploadFile: vi.fn() }));

const FILE: FileInfo = {
  id: 'f1',
  name: 'brief.pdf',
  mime: 'application/pdf',
  size: 1024,
  width: null,
  height: null,
  hasPreview: false,
};

function Harness({ max }: { max: number }) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  return (
    <>
      <span id="files-label">Files</span>
      <FilesField
        groupId="g1"
        labelId="files-label"
        max={max}
        fileIds={files.map((f) => f.id)}
        files={files}
        onAdd={(file) => setFiles((list) => [...list, file])}
        onRemove={(id) => setFiles((list) => list.filter((f) => f.id !== id))}
      />
    </>
  );
}

describe('FilesField', () => {
  it('with max 1 the picker is single and Attach hides once a file is attached', async () => {
    let finish!: (file: FileInfo) => void;
    vi.mocked(uploadFile).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<Harness max={1} />);
    const input = screen.getByTestId('task-file-input');
    expect(input).not.toHaveAttribute('multiple');
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeEnabled();

    await user.upload(input, new File(['x'], 'brief.pdf'));
    await act(async () => finish(FILE));

    expect(screen.getByRole('button', { name: 'Remove brief.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach a file' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove brief.pdf' }));
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeEnabled();
  });

  it('with max above 1 the picker takes several files', () => {
    render(<Harness max={20} />);
    expect(screen.getByTestId('task-file-input')).toHaveAttribute('multiple');
  });
});
