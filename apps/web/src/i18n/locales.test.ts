import { describe, expect, it } from 'vitest';
import en from '@/locales/en.json';
import sk from '@/locales/sk.json';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('locales', () => {
  it('en.json and sk.json have identical keys', () => {
    const enKeys = new Set(flatten(en));
    const skKeys = new Set(flatten(sk));
    const missingInSk = [...enKeys].filter((k) => !skKeys.has(k));
    const missingInEn = [...skKeys].filter((k) => !enKeys.has(k));
    expect({ missingInSk, missingInEn }).toEqual({ missingInSk: [], missingInEn: [] });
  });
});
