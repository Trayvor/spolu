import { describe, expect, it } from 'vitest';
import { parseRange } from '../files/routes.js';
import { matchPerson } from './meeting-tasks.js';
import { isRecordingUpload } from './meeting-recording.js';

const people = [
  { id: 'a', name: 'Peter Novák' },
  { id: 'b', name: 'Anna Malá' },
  { id: 'c', name: 'Anna Veľká' },
];

describe('matchPerson', () => {
  it('matches a whole name or a unique first name, ignoring case and diacritics', () => {
    expect(matchPerson('peter novak', people)).toBe('a');
    expect(matchPerson('Peter', people)).toBe('a');
    expect(matchPerson('Anna Malá', people)).toBe('b');
  });
  it('a shared first name, an unknown one or none is no match', () => {
    expect(matchPerson('Anna', people)).toBeNull();
    expect(matchPerson('Jozef', people)).toBeNull();
    expect(matchPerson(null, people)).toBeNull();
    expect(matchPerson('  ', people)).toBeNull();
  });
});

describe('isRecordingUpload', () => {
  it('takes audio and video types, and an octet stream with a media name', () => {
    expect(isRecordingUpload('audio/mpeg', 'a')).toBe(true);
    expect(isRecordingUpload('video/mp4; codecs=avc1', 'a')).toBe(true);
    expect(isRecordingUpload('application/octet-stream', 'call.M4A')).toBe(true);
    expect(isRecordingUpload(undefined, 'call.webm')).toBe(true);
    expect(isRecordingUpload('application/pdf', 'call.mp3')).toBe(false);
    expect(isRecordingUpload('application/octet-stream', 'notes.txt')).toBe(false);
  });
});

describe('parseRange', () => {
  it('reads one range of bytes', () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange('bytes=0-3', 10)).toEqual({ start: 0, end: 3 });
    expect(parseRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=5-100', 10)).toEqual({ start: 5, end: 9 });
  });
  it('several ranges or a malformed header: the whole file; past the end: unsatisfiable', () => {
    expect(parseRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(parseRange('items=0-1', 10)).toBeNull();
    expect(parseRange('bytes=5-2', 10)).toBeNull();
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable');
  });
});
