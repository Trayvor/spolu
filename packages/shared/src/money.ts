import { z } from 'zod';

/**
 * Money (Phase 32, finance): integer minor units (cents) plus an ISO 4217 code, never a float
 * and never converted between currencies. `Currencies` are the ones the data may hold;
 * `ENABLED_CURRENCIES` the ones a form may enter today — the one switch that turns UAH on.
 */
export const Currencies = ['EUR', 'UAH'] as const;
export const CurrencySchema = z.enum(Currencies);
export type Currency = z.infer<typeof CurrencySchema>;

export const ENABLED_CURRENCIES: readonly Currency[] = ['EUR'];

/** Digits after the decimal point, per currency. */
export const MINOR_DIGITS: Readonly<Record<Currency, number>> = { EUR: 2, UAH: 2 };

/** Hourly rates, and therefore the cost of work, are in this currency (owner decision 11). */
export const COST_CURRENCY: Currency = 'EUR';

const AmountMinorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** An amount as stored and answered: any known currency. */
export const MoneySchema = z.object({ amountMinor: AmountMinorSchema, currency: CurrencySchema });
export type Money = z.infer<typeof MoneySchema>;

/** An amount a form sends: only an enabled currency. */
export const MoneyInputSchema = z.object({
  amountMinor: AmountMinorSchema,
  currency: CurrencySchema.refine((c) => ENABLED_CURRENCIES.includes(c), {
    message: 'currency not enabled',
  }),
});

/**
 * Formats with `Intl.NumberFormat` in the UI language: `formatMoney({ amountMinor: 120050,
 * currency: 'EUR' }, 'sk')` is `1 200,50 €`. `whole` drops the cents (chart labels, totals).
 */
export function formatMoney(money: Money, locale: string, opts: { whole?: boolean } = {}): string {
  const digits = MINOR_DIGITS[money.currency];
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: opts.whole ? 0 : digits,
    maximumFractionDigits: opts.whole ? 0 : digits,
  }).format(money.amountMinor / 10 ** digits);
}

/** `1`, `12`, `123` then groups of exactly three digits; never a leading zero before a group. */
function validGroups(groups: string[]): boolean {
  const [first, ...rest] = groups;
  if (!first || !/^\d{1,3}$/.test(first)) return false;
  if (rest.length > 0 && first.startsWith('0')) return false;
  return rest.every((g) => /^\d{3}$/.test(g));
}

/**
 * Reads an amount as people type it: `1200`, `1200.50`, `1200,50`, `1 200,50`, `1.200,50`,
 * `1,200.50`, with or without `€`. With both `.` and `,` the last one is the decimal mark.
 * With one kind only: once and followed by exactly three digits it groups thousands
 * (`1.200`), otherwise it is the decimal mark. Null when the text is no amount, is negative or
 * has more decimals than the currency.
 */
export function parseMoney(text: string, currency: Currency): Money | null {
  const cleaned = text.replace(/[\s\u00a0\u202f€₴]|EUR|UAH/giu, '');
  if (!/^\d[\d.,]*$/.test(cleaned) || /[.,]$/.test(cleaned)) return null;
  const digits = MINOR_DIGITS[currency];
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let whole: string;
  let fraction = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    const [intPart, frac, ...more] = cleaned.split(decimal);
    if (more.length > 0 || intPart === undefined || frac === undefined) return null;
    if (frac.includes(thousands) || !validGroups(intPart.split(thousands))) return null;
    whole = intPart.split(thousands).join('');
    fraction = frac;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const mark = lastDot >= 0 ? '.' : ',';
    const parts = cleaned.split(mark);
    const isThousands = parts.length > 2 || parts[1]!.length === 3;
    if (isThousands) {
      if (!validGroups(parts)) return null;
      whole = parts.join('');
    } else {
      whole = parts[0]!;
      fraction = parts[1]!;
    }
  } else {
    whole = cleaned;
  }
  if (fraction.length > digits) return null;
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { amountMinor: Number(minor), currency };
}
