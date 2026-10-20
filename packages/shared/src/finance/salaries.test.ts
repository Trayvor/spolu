import { describe, expect, it } from 'vitest';
import { SalariesQuerySchema, SalaryBodySchema, SalaryPatchSchema } from './salaries.js';

const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' });

describe('salary schemas (2026-10-21)', () => {
  const body = { payeeId: 'u1', month: '2026-09', amount: eur(250_000) };

  it('takes an admin, a month and an amount of 0 or more, the note and files optional', () => {
    const parsed = SalaryBodySchema.parse(body);
    expect(parsed).toEqual({ ...body, note: '', fileIds: [] });
    expect(SalaryBodySchema.safeParse({ ...body, amount: eur(0) }).success).toBe(true);
  });

  it('refuses a negative or fractional amount, a bad month, a disabled currency, a day', () => {
    const bad = [
      { ...body, amount: eur(-1) },
      { ...body, amount: eur(1.5) },
      { ...body, amount: { amountMinor: 1, currency: 'UAH' } },
      { ...body, month: '2026-13' },
      { ...body, month: '2026-09-01' },
      { ...body, payeeId: undefined },
      { ...body, note: 'a\0b' },
      { ...body, extra: 1 },
    ];
    for (const b of bad) expect(SalaryBodySchema.safeParse(b).success).toBe(false);
  });

  it('a patch needs the updatedAt it edits', () => {
    expect(SalaryPatchSchema.safeParse({ month: '2026-10' }).success).toBe(false);
    expect(SalaryPatchSchema.safeParse({ updatedAt: 'x', month: '2026-10' }).success).toBe(true);
  });

  it('a month range needs both ends in order', () => {
    expect(SalariesQuerySchema.safeParse({ from: '2026-01' }).success).toBe(false);
    expect(SalariesQuerySchema.safeParse({ from: '2026-05', to: '2026-01' }).success).toBe(false);
    expect(SalariesQuerySchema.safeParse({ from: '2026-01', to: '2026-05' }).success).toBe(true);
    expect(SalariesQuerySchema.safeParse({}).success).toBe(true);
  });
});
