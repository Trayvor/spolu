import { describe, expect, it } from 'vitest';
import {
  EventCreateBodySchema,
  ProjectColors,
  ProjectCreateBodySchema,
  parseEgrantDate,
  projectColor,
} from '../index.js';

describe('projectColor', () => {
  it('is stable for an id and one of the five accents', () => {
    expect(projectColor('abc')).toBe(projectColor('abc'));
    expect(ProjectColors).toContain(projectColor('abc'));
    const seen = new Set(Array.from({ length: 50 }, (_, i) => projectColor(`p${i}`)));
    expect(seen.size).toBe(5);
  });
});

describe('parseEgrantDate', () => {
  it.each([
    ['04.11.2026', '2026-11-04'],
    ['29.02.2028', '2028-02-29'],
    ['31.02.2026', null],
    ['4.11.2026', null],
    ['2026-11-04', null],
    [' 04.11.2026', null],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(parseEgrantDate(input)).toBe(expected);
  });
});

describe('project bodies', () => {
  it('trims the name, defaults the rest, drops duplicate files', () => {
    expect(ProjectCreateBodySchema.parse({ name: '  Kultúra ', fileIds: ['a', 'a'] })).toEqual({
      name: 'Kultúra',
      description: '',
      fileIds: ['a'],
    });
    expect(ProjectCreateBodySchema.safeParse({ name: ' ' }).success).toBe(false);
  });

  it('an event needs a real YYYY-MM-DD date', () => {
    expect(EventCreateBodySchema.safeParse({ name: 'E', occursOn: '2026-02-30' }).success).toBe(
      false,
    );
    expect(EventCreateBodySchema.safeParse({ name: 'E', occursOn: '2026-02-28' }).success).toBe(
      true,
    );
  });
});
