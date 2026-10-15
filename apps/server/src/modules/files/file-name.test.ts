import { describe, expect, it } from 'vitest';
import { decodeFileNameHeader, sanitizeFileName } from './file-name.js';

describe('file names', () => {
  it('removes path separators from a decoded traversal attempt', () => {
    expect(sanitizeFileName(decodeFileNameHeader('..%2F..%2Fetc%2Fpasswd'))).toBe('....etcpasswd');
    expect(sanitizeFileName('a\\b.pdf')).toBe('ab.pdf');
  });

  it('keeps an undecodable header as it is', () => {
    expect(decodeFileNameHeader('%E0%A4%A')).toBe('%E0%A4%A');
  });

  it('trims and truncates to 255 characters', () => {
    expect(sanitizeFileName('  report.pdf  ')).toBe('report.pdf');
    expect(Array.from(sanitizeFileName('é'.repeat(300)))).toHaveLength(255);
  });

  it('falls back to "file" for an empty or control-only name', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('\u0000')).toBe('file');
  });

  it('treats a missing header as empty', () => {
    expect(decodeFileNameHeader(undefined)).toBe('');
  });
});
