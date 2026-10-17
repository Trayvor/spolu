import { describe, expect, it } from 'vitest';
import { MAX_ENTRY_MINUTES, formatDuration, parseDuration } from './duration.js';

describe('parseDuration', () => {
  it.each([
    ['1:30', 90],
    ['0:45', 45],
    ['1,5', 90],
    ['1.5', 90],
    ['2', 120],
    ['0', 0],
    ['0,25', 15],
    ['90m', 90],
    ['90 min', 90],
    ['2h', 120],
    ['2 h', 120],
    ['2h 15m', 135],
    ['2h15m', 135],
    ['1 h 30 min', 90],
    ['1,5h', 90],
    ['  45 MIN ', 45],
    ['1.33', 80],
    ['100', 6000],
  ])('%j -> %d minutes', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });

  it.each([
    [''],
    ['abc'],
    ['-1'],
    ['1:75'],
    ['1:3'],
    ['h'],
    ['2h 15'],
    ['1.5.2'],
    ['100:01'],
    ['101'],
  ])('refuses %j', (text) => {
    expect(parseDuration(text)).toBeNull();
  });

  it('the limit is 100 hours', () => {
    expect(MAX_ENTRY_MINUTES).toBe(6000);
    expect(parseDuration('6000m')).toBe(6000);
    expect(parseDuration('6001m')).toBeNull();
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0 min'],
    [15, '15 min'],
    [60, '1 h'],
    [90, '1 h 30 min'],
    [135, '2 h 15 min'],
    [6000, '100 h'],
  ])('%d -> %j', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });

  it('takes the units of the UI language', () => {
    expect(formatDuration(90, { hours: 'год', minutes: 'хв' })).toBe('1 год 30 хв');
  });

  it('round-trips through parseDuration', () => {
    for (const m of [0, 5, 59, 60, 61, 90, 600]) expect(parseDuration(formatDuration(m))).toBe(m);
  });
});
