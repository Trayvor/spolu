import { inflateRawSync } from 'node:zlib';
import { MEETING_LIMITS } from '@spolu/shared';
import { InvalidTranscriptFileError } from './errors.js';

// Phase 30: the text of an uploaded transcript file (.txt, .vtt, .srt, .docx), without storing it.

const TIMING =
  /^\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;

const decodeUtf8 = (bytes: Buffer): string => {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
};

const decodeEntities = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

/**
 * WebVTT or SubRip cues as plain lines: no header, cue numbers, timings, `NOTE`/`STYLE` blocks
 * or tags; a voice tag `<v Name>` becomes "Name: ". A speaker's consecutive identical lines are
 * kept once.
 */
export function subtitlesToText(source: string): string {
  const lines: string[] = [];
  const blocks = source.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const rows = block.split('\n');
    const head = rows[0]?.trim() ?? '';
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(head)) continue;
    const timing = rows.findIndex((row) => TIMING.test(row));
    if (timing < 0) continue;
    for (const row of rows.slice(timing + 1)) {
      const voice = /^<v(?:\.[^\s>]+)?\s+([^>]+)>/.exec(row.trim());
      const text = decodeEntities(row.replace(/<[^>]*>/g, '')).trim();
      if (text === '') continue;
      const line = voice ? `${voice[1]!.trim()}: ${text}` : text;
      if (lines[lines.length - 1] !== line) lines.push(line);
    }
  }
  return lines.join('\n');
}

/** The bytes of one entry of a zip archive, or null when it is not there. Deflate or stored. */
function readZipEntry(zip: Buffer, name: string): Buffer | null {
  // The end of central directory record: within the last 64 KiB + 22 bytes.
  const min = Math.max(0, zip.length - 65_557);
  let eocd = -1;
  for (let i = zip.length - 22; i >= min; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && at + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entryName = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    if (entryName === name) {
      if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) return null;
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 });
      return null;
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** A .docx's text: one line per paragraph, tabs and breaks kept. */
function docxToText(bytes: Buffer): string {
  const xml = readZipEntry(bytes, 'word/document.xml');
  if (!xml) throw new InvalidTranscriptFileError();
  const body = xml.toString('utf8');
  const paragraphs = body.split(/<\/w:p>/);
  const lines = paragraphs.map((paragraph) => {
    let text = '';
    for (const match of paragraph.matchAll(
      /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br)\b[^>]*\/>/g,
    )) {
      if (match[2] === 'tab') text += '\t';
      else if (match[2] === 'br') text += '\n';
      else text += decodeEntities(match[1] ?? '');
    }
    return text.trimEnd();
  });
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The text of a transcript file by its name's extension; anything else (or an unreadable
 * .docx) InvalidTranscriptFileError. Cut to the transcript limit.
 */
export function transcriptFileText(name: string, bytes: Buffer): string {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  let text: string;
  try {
    if (extension === 'txt') text = decodeUtf8(bytes).replace(/\r\n?/g, '\n').trim();
    else if (extension === 'vtt' || extension === 'srt') text = subtitlesToText(decodeUtf8(bytes));
    else if (extension === 'docx') text = docxToText(bytes);
    else throw new InvalidTranscriptFileError();
  } catch (error) {
    if (error instanceof InvalidTranscriptFileError) throw error;
    throw new InvalidTranscriptFileError();
  }
  return Array.from(text).slice(0, MEETING_LIMITS.transcript).join('');
}
