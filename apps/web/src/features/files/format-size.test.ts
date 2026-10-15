import { describe, expect, it } from 'vitest';
import { formatFileSize } from './format-size';

describe('formatFileSize', () => {
  it('writes bytes below 1 KiB', () => {
    expect(formatFileSize(512, 'en')).toMatch(/^512\s*(byte|B)/);
  });

  it('writes 1536 bytes as 1.5 kB', () => {
    expect(formatFileSize(1536, 'en')).toMatch(/1\.5\s*kB/);
  });

  it('writes 25 MiB as 25 MB', () => {
    expect(formatFileSize(26_214_400, 'en')).toMatch(/25\s*MB/);
  });

  it('uses the decimal separator of the language', () => {
    expect(formatFileSize(1536, 'sk')).toMatch(/1,5/);
  });
});
