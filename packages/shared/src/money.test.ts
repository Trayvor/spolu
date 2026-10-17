import { describe, expect, it } from 'vitest';
import {
  ENABLED_CURRENCIES,
  MoneyInputSchema,
  MoneySchema,
  formatMoney,
  parseMoney,
} from './money.js';

describe('parseMoney', () => {
  it.each([
    ['1200', 120000],
    ['1200.50', 120050],
    ['1200,50', 120050],
    ['1 200,50', 120050],
    ['1\u00a0200,50', 120050],
    ['1\u202f200,5', 120050],
    ['1.200,50', 120050],
    ['1,200.50', 120050],
    ['1,200', 120000],
    ['1.200', 120000],
    ['1.200.300', 120030000],
    ['12 000 €', 1200000],
    ['€ 12,5', 1250],
    ['0', 0],
    ['0,99', 99],
    ['  7  ', 700],
  ])('%j -> %d minor units', (text, minor) => {
    expect(parseMoney(text, 'EUR')).toEqual({ amountMinor: minor, currency: 'EUR' });
  });

  it.each([
    [''],
    ['abc'],
    ['-5'],
    ['1,234,5'],
    ['1.2.3,45,6'],
    ['1,2,3'],
    ['0.123'],
    ['.5'],
    ['5.'],
  ])('refuses %j', (text) => {
    expect(parseMoney(text, 'EUR')).toBeNull();
  });

  it('refuses more decimals than the currency has', () => {
    expect(parseMoney('1,505', 'EUR')?.amountMinor).toBe(150500); // three digits: thousands
    expect(parseMoney('1,5055', 'EUR')).toBeNull();
  });

  it('refuses an amount above the safe integer range', () => {
    expect(parseMoney('99999999999999999', 'EUR')).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats minor units with the currency and the locale', () => {
    expect(formatMoney({ amountMinor: 120050, currency: 'EUR' }, 'en')).toBe('€1,200.50');
    expect(formatMoney({ amountMinor: 120050, currency: 'EUR' }, 'sk')).toMatch(/^1\s200,50\s€$/u);
    expect(formatMoney({ amountMinor: 0, currency: 'EUR' }, 'en')).toBe('€0.00');
  });

  it('can drop the cents of a whole amount', () => {
    expect(formatMoney({ amountMinor: 1200000, currency: 'EUR' }, 'en', { whole: true })).toBe(
      '€12,000',
    );
  });
});

describe('money schemas', () => {
  it('only EUR is enabled for input today', () => {
    expect(ENABLED_CURRENCIES).toEqual(['EUR']);
    expect(MoneyInputSchema.safeParse({ amountMinor: 100, currency: 'EUR' }).success).toBe(true);
    expect(MoneyInputSchema.safeParse({ amountMinor: 100, currency: 'UAH' }).success).toBe(false);
    // An answer may still carry a known currency that input does not accept yet.
    expect(MoneySchema.safeParse({ amountMinor: 100, currency: 'UAH' }).success).toBe(true);
  });

  it('refuses negative, fractional and unknown amounts', () => {
    expect(MoneySchema.safeParse({ amountMinor: -1, currency: 'EUR' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amountMinor: 1.5, currency: 'EUR' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amountMinor: 1, currency: 'USD' }).success).toBe(false);
  });
});
