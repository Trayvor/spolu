import { describe, expect, it } from 'vitest';
import { sniffAllowedType, sniffImageType } from './sniff.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([1, 2, 3, 4]),
  Buffer.from('WEBPVP8 '),
]);

describe('sniffImageType', () => {
  it('recognises PNG, JPEG and WebP by magic bytes', () => {
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
    expect(sniffImageType(webp)).toBe('image/webp');
  });

  it('rejects a PDF, a WAV (RIFF but not WEBP), a truncated header and empty input', () => {
    expect(sniffImageType(Buffer.from('%PDF-1.7 hello'))).toBeNull();
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([1, 2, 3, 4]),
      Buffer.from('WAVEfmt '),
    ]);
    expect(sniffImageType(wav)).toBeNull();
    expect(sniffImageType(png.subarray(0, 5))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('sniffAllowedType', () => {
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(30)]);
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);

  it('takes images and PDF by their bytes, whatever the name says', () => {
    expect(sniffAllowedType(png, 'shot.pdf')).toBe('image/png');
    expect(sniffAllowedType(jpeg, 'a')).toBe('image/jpeg');
    expect(sniffAllowedType(webp, 'a.webp')).toBe('image/webp');
    expect(sniffAllowedType(Buffer.from('GIF89a\x01\x00'), 'a.gif')).toBe('image/gif');
    expect(sniffAllowedType(Buffer.from('%PDF-1.7\n%...'), 'scan.png')).toBe('application/pdf');
  });

  it('takes Office and OpenDocument files and ZIP archives by bytes and extension', () => {
    expect(sniffAllowedType(zip, 'rozpocet.XLSX')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(sniffAllowedType(zip, 'a.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(sniffAllowedType(zip, 'a.odt')).toBe('application/vnd.oasis.opendocument.text');
    expect(sniffAllowedType(zip, 'a.zip')).toBe('application/zip');
    expect(sniffAllowedType(ole, 'a.doc')).toBe('application/msword');
    expect(sniffAllowedType(ole, 'a.xls')).toBe('application/vnd.ms-excel');
    expect(sniffAllowedType(Buffer.from('{\\rtf1\\ansi hi}'), 'a.rtf')).toBe('application/rtf');
  });

  it('takes UTF-8 text named .txt or .csv', () => {
    expect(sniffAllowedType(Buffer.from('Ahoj, svet\nčau'), 'log.txt')).toBe('text/plain');
    expect(sniffAllowedType(Buffer.from('a;b\n1;2'), 'data.csv')).toBe('text/csv');
  });

  it('rejects everything else', () => {
    // A Windows executable, a ZIP named like a program, OLE named like a picture.
    expect(sniffAllowedType(Buffer.from('MZ\x90\x00\x03\x00'), 'setup.exe')).toBeNull();
    expect(sniffAllowedType(Buffer.from('MZ\x90\x00\x03\x00'), 'setup.pdf')).toBeNull();
    expect(sniffAllowedType(zip, 'app.jar')).toBeNull();
    expect(sniffAllowedType(ole, 'a.png')).toBeNull();
    // HTML and SVG are text, but not plain text.
    expect(sniffAllowedType(Buffer.from('<html><script>x</script>'), 'a.html')).toBeNull();
    expect(sniffAllowedType(Buffer.from('<svg/>'), 'a.svg')).toBeNull();
    expect(sniffAllowedType(Buffer.from('<svg/>'), 'a.txt')).toBe('text/plain');
    // Text with a NUL byte or invalid UTF-8 is binary.
    expect(sniffAllowedType(Buffer.from([0x61, 0x00, 0x62]), 'a.txt')).toBeNull();
    expect(sniffAllowedType(Buffer.from([0x61, 0xff, 0x62]), 'a.txt')).toBeNull();
    expect(sniffAllowedType(Buffer.alloc(0), 'a.txt')).toBeNull();
  });
});
