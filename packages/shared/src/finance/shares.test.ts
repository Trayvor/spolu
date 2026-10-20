import { describe, expect, it } from 'vitest';
import { FinanceItemPatchSchema, FinanceOrgItemBodySchema, shareProblem } from './documents.js';

/** Phase 32 E (decisions O1, E8): the shares of a contract of several clients. */
describe('shareProblem', () => {
  const a = (amountMinor: number, groupId = 'a') => ({ groupId, amountMinor });

  it('accepts shares that add up exactly to the amount', () => {
    expect(shareProblem(100_000, [a(60_000, 'a'), a(40_000, 'b')])).toBeNull();
  });

  it('refuses a sum a cent off either way', () => {
    expect(shareProblem(100_000, [a(60_000, 'a'), a(39_999, 'b')])).toBe('sum');
    expect(shareProblem(100_000, [a(60_000, 'a'), a(40_001, 'b')])).toBe('sum');
  });

  it('needs two to fifty clients, each once, none below zero', () => {
    expect(shareProblem(10, [a(10)])).toBe('tooFew');
    expect(shareProblem(10, [])).toBe('tooFew');
    const many = Array.from({ length: 51 }, (_, i) => a(1, `g${i}`));
    expect(shareProblem(51, many)).toBe('tooMany');
    expect(shareProblem(50, many.slice(0, 50))).toBeNull();
    expect(shareProblem(20, [a(10, 'a'), a(10, 'a')])).toBe('duplicate');
    expect(shareProblem(1, [a(1, 'a'), a(0, 'b')])).toBeNull();
    expect(shareProblem(10, [a(-5, 'a'), a(15, 'b')])).toBe('negative');
    expect(shareProblem(10, [a(2.5, 'a'), a(7.5, 'b')])).toBe('negative');
  });

  it('adds without floating point (large amounts)', () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    expect(shareProblem(big, [a(big - 1, 'a'), a(1, 'b')])).toBeNull();
  });
});

describe('FinanceOrgItemBodySchema', () => {
  const contract = {
    type: 'contract',
    title: 'Grant pre tri obce',
    amount: { amountMinor: 300_000, currency: 'EUR' },
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
    payerName: 'Mikroregión Horehronie',
    shares: [
      { groupId: 'g1', amountMinor: 100_000 },
      { groupId: 'g2', amountMinor: 200_000 },
    ],
  };

  it('takes a contract of several clients whose shares add up', () => {
    expect(FinanceOrgItemBodySchema.safeParse(contract).success).toBe(true);
  });

  it('refuses shares that do not add up, a missing payer, one client, another currency', () => {
    const bad = [
      { ...contract, shares: [contract.shares[0], { groupId: 'g2', amountMinor: 1 }] },
      { ...contract, payerName: '  ' },
      { ...contract, payerName: undefined },
      { ...contract, shares: [{ groupId: 'g1', amountMinor: 300_000 }] },
      { ...contract, shares: [contract.shares[0], { groupId: 'g1', amountMinor: 200_000 }] },
      { ...contract, amount: { amountMinor: 300_000, currency: 'UAH' } },
      { ...contract, shares: contract.shares.map((s) => ({ ...s, currency: 'UAH' })) },
    ];
    for (const body of bad) expect(FinanceOrgItemBodySchema.safeParse(body).success).toBe(false);
  });

  const expense = {
    type: 'expense',
    title: 'Server Hetzner',
    amount: { amountMinor: 250_000, currency: 'EUR' },
    spentOn: '2026-10-31',
  };

  it('takes an expense with its title, its kind "other" by default (no salary since 2026-10-21)', () => {
    const parsed = FinanceOrgItemBodySchema.safeParse(expense);
    expect(parsed.success && parsed.data.type === 'expense' && parsed.data.expenseKind).toBe(
      'other',
    );
    expect(FinanceOrgItemBodySchema.safeParse({ ...expense, expenseKind: 'other' }).success).toBe(
      true,
    );
  });

  it('refuses a salary expense, a payee, an expense without a title or with a bad date', () => {
    const bad = [
      { ...expense, expenseKind: 'salary' },
      { ...expense, payeeId: 'u1' },
      { ...expense, title: '   ' },
      { ...expense, title: undefined },
      { ...expense, spentOn: '2026-02-30' },
      { ...expense, amount: { amountMinor: -1, currency: 'EUR' } },
      { ...expense, groupId: 'g1' },
    ];
    for (const body of bad) expect(FinanceOrgItemBodySchema.safeParse(body).success).toBe(false);
  });

  it('a patch takes the payer, the shares and the expense date, never the kind or a payee', () => {
    expect(
      FinanceItemPatchSchema.safeParse({
        updatedAt: 'x',
        payerName: 'Obec',
        shares: [{ groupId: 'g1', amountMinor: 1 }],
        spentOn: '2026-11-30',
      }).success,
    ).toBe(true);
    expect(FinanceItemPatchSchema.safeParse({ updatedAt: 'x', payeeId: 'u2' }).success).toBe(false);
    expect(FinanceItemPatchSchema.safeParse({ updatedAt: 'x', expenseKind: 'other' }).success).toBe(
      false,
    );
  });
});
