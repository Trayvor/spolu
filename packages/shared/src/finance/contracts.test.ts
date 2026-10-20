import { describe, expect, it } from 'vitest';
import {
  addMonths,
  ContractLinkInputSchema,
  partOf,
  periodStatus,
  scheduleDueDays,
  ScheduleInputSchema,
  scheduleProblem,
  schedulePeriods,
} from './contracts.js';
import { FinanceItemBodySchema, FinanceOrgItemBodySchema, shareProblem } from './documents.js';

const due = (s: Parameters<typeof scheduleDueDays>[0], end = '2030-12-31') =>
  scheduleDueDays(s, end).days.map((d) => d.dueOn);

describe('addMonths (month ends, leap years)', () => {
  it('keeps the anchor day and clamps to a short month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonths('2026-01-30', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('crosses years both ways', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(addMonths('2026-12-01', 12)).toBe('2027-12-01');
    expect(addMonths('2026-02-01', -2)).toBe('2025-12-01');
  });

  it('29 February yearly falls on 28 February in common years, back to 29 in leap years', () => {
    const days = due({
      frequency: 'yearly',
      everyMonths: null,
      startsOn: '2028-02-29',
      endsOn: '2033-03-01',
    });
    expect(days).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
      '2033-02-28',
    ]);
  });
});

describe('scheduleDueDays', () => {
  it('monthly from 31 January stays on month ends without drifting', () => {
    const days = due({
      frequency: 'monthly',
      everyMonths: null,
      startsOn: '2026-01-31',
      endsOn: '2026-05-31',
    });
    expect(days).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('quarterly, every 6 months and every N months', () => {
    const base = { everyMonths: null, startsOn: '2026-01-15', endsOn: '2026-12-31' };
    expect(due({ ...base, frequency: 'quarterly' })).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-07-15',
      '2026-10-15',
    ]);
    expect(due({ ...base, frequency: 'semiannual' })).toEqual(['2026-01-15', '2026-07-15']);
    expect(due({ ...base, frequency: 'everyMonths', everyMonths: 5 })).toEqual([
      '2026-01-15',
      '2026-06-15',
      '2026-11-15',
    ]);
  });

  it('without its own end runs until the contract ends (inclusive)', () => {
    const days = due(
      { frequency: 'monthly', everyMonths: null, startsOn: '2026-10-01', endsOn: null },
      '2027-01-01',
    );
    expect(days).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
  });

  it('periods run from one due day to the next, the last one open', () => {
    const { days } = scheduleDueDays(
      { frequency: 'quarterly', everyMonths: null, startsOn: '2026-01-01', endsOn: '2026-06-30' },
      '2026-12-31',
    );
    expect(days).toEqual([
      { dueOn: '2026-01-01', until: '2026-04-01' },
      { dueOn: '2026-04-01', until: null },
    ]);
  });

  it('a custom list is sorted', () => {
    expect(due({ frequency: 'dates', dates: ['2026-09-01', '2026-03-15', '2026-06-30'] })).toEqual([
      '2026-03-15',
      '2026-06-30',
      '2026-09-01',
    ]);
  });

  it('refuses a schedule with no payment or too many', () => {
    expect(
      scheduleProblem(
        { frequency: 'monthly', everyMonths: null, startsOn: '2027-01-01', endsOn: null },
        '2026-12-31',
      ),
    ).toBe('empty');
    expect(
      scheduleProblem(
        { frequency: 'monthly', everyMonths: null, startsOn: '2000-01-01', endsOn: '2060-01-01' },
        '2060-01-01',
      ),
    ).toBe('tooMany');
    expect(
      scheduleProblem(
        { frequency: 'monthly', everyMonths: null, startsOn: '2026-01-01', endsOn: null },
        '2026-12-31',
      ),
    ).toBeNull();
  });
});

describe('paid detection', () => {
  const today = '2026-03-20';
  const monthly = {
    frequency: 'monthly' as const,
    everyMonths: null,
    startsOn: '2026-01-01',
    endsOn: '2026-05-31',
    amountMinor: 60_000,
  };

  it('a period is paid when the payments dated in it add up to the expected amount', () => {
    const periods = schedulePeriods(
      monthly,
      '2026-12-31',
      [
        { amountMinor: 60_000, paidOn: '2026-01-10' },
        { amountMinor: 20_000, paidOn: '2026-02-01' },
        { amountMinor: 40_000, paidOn: '2026-02-28' },
        { amountMinor: 10_000, paidOn: '2026-03-02' },
      ],
      today,
    );
    expect(periods.map((p) => [p.dueOn, p.received, p.status])).toEqual([
      ['2026-01-01', 60_000, 'paid'],
      ['2026-02-01', 60_000, 'paid'],
      ['2026-03-01', 10_000, 'partial'],
      ['2026-04-01', 0, 'upcoming'],
      ['2026-05-01', 0, 'upcoming'],
    ]);
  });

  it('a due period without payment is unpaid; payments before the first day count for none', () => {
    const periods = schedulePeriods(
      monthly,
      '2026-12-31',
      [{ amountMinor: 60_000, paidOn: '2025-12-31' }],
      today,
    );
    expect(periods[0]!.status).toBe('unpaid');
    expect(periods.reduce((s, p) => s + p.received, 0)).toBe(0);
  });

  it('a late payment still counts for the last, open period', () => {
    const periods = schedulePeriods(
      { frequency: 'dates', dates: ['2026-01-01', '2026-02-01'], amountMinor: 1_000 },
      '2026-12-31',
      [{ amountMinor: 1_000, paidOn: '2026-11-30' }],
      '2026-12-01',
    );
    expect(periods.map((p) => p.status)).toEqual(['unpaid', 'paid']);
  });

  it('an amount of 0 is paid once due, and coming until then', () => {
    expect(periodStatus(0, 0, '2026-01-01', today)).toBe('paid');
    expect(periodStatus(0, 0, '2026-04-01', today)).toBe('upcoming');
    expect(periodStatus(100, 100, '2026-04-01', today)).toBe('paid');
    expect(periodStatus(100, 150, '2026-01-01', today)).toBe('paid');
  });
});

describe('partOf (a client share of a contract of several clients)', () => {
  it('scales in whole cents, half up, without floating point', () => {
    expect(partOf(60_000, 1, 3)).toBe(20_000);
    expect(partOf(100, 1, 3)).toBe(33);
    expect(partOf(100, 2, 3)).toBe(67);
    expect(partOf(5, 1, 2)).toBe(3);
    expect(partOf(500, 7, 7)).toBe(500);
    expect(partOf(500, 0, 0)).toBe(0);
    expect(partOf(Number.MAX_SAFE_INTEGER, 1, 1)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('ScheduleInputSchema', () => {
  it('accepts every frequency and an amount of 0', () => {
    for (const frequency of ['monthly', 'quarterly', 'semiannual', 'yearly'] as const) {
      expect(
        ScheduleInputSchema.safeParse({ frequency, amountMinor: 0, startsOn: '2026-01-01' })
          .success,
      ).toBe(true);
    }
    expect(
      ScheduleInputSchema.safeParse({
        frequency: 'everyMonths',
        everyMonths: 2,
        amountMinor: 100,
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
      }).success,
    ).toBe(true);
    expect(
      ScheduleInputSchema.safeParse({
        frequency: 'dates',
        dates: ['2026-01-01', '2026-02-29'],
        amountMinor: 1,
      }).success,
    ).toBe(false); // 2026 has no 29 February
    expect(
      ScheduleInputSchema.safeParse({ frequency: 'dates', dates: ['2028-02-29'], amountMinor: 1 })
        .success,
    ).toBe(true);
  });

  it('refuses a negative amount, N without everyMonths, an end before the start, a repeated day', () => {
    const base = { frequency: 'monthly', startsOn: '2026-01-01' };
    expect(ScheduleInputSchema.safeParse({ ...base, amountMinor: -1 }).success).toBe(false);
    expect(ScheduleInputSchema.safeParse({ ...base, amountMinor: 1, everyMonths: 2 }).success).toBe(
      false,
    );
    expect(
      ScheduleInputSchema.safeParse({
        frequency: 'everyMonths',
        amountMinor: 1,
        startsOn: '2026-01-01',
      }).success,
    ).toBe(false);
    expect(
      ScheduleInputSchema.safeParse({ ...base, amountMinor: 1, endsOn: '2025-12-31' }).success,
    ).toBe(false);
    expect(
      ScheduleInputSchema.safeParse({
        frequency: 'dates',
        dates: ['2026-01-01', '2026-01-01'],
        amountMinor: 1,
      }).success,
    ).toBe(false);
  });
});

describe('zero amounts (owner request 2026-10-21)', () => {
  const contract = {
    type: 'contract',
    title: 'Rámcová zmluva',
    amount: { amountMinor: 0, currency: 'EUR' },
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
  };

  it('a contract of one client may be 0', () => {
    expect(FinanceItemBodySchema.safeParse(contract).success).toBe(true);
  });

  it('a contract of several clients may be 0, with shares of 0', () => {
    expect(
      shareProblem(0, [
        { groupId: 'a', amountMinor: 0 },
        { groupId: 'b', amountMinor: 0 },
      ]),
    ).toBeNull();
    expect(
      shareProblem(10, [
        { groupId: 'a', amountMinor: 10 },
        { groupId: 'b', amountMinor: 0 },
      ]),
    ).toBeNull();
    expect(
      shareProblem(0, [
        { groupId: 'a', amountMinor: -1 },
        { groupId: 'b', amountMinor: 1 },
      ]),
    ).toBe('negative');
    expect(
      FinanceOrgItemBodySchema.safeParse({
        ...contract,
        payerName: 'Mikroregión',
        shares: [
          { groupId: 'a', amountMinor: 0 },
          { groupId: 'b', amountMinor: 0 },
        ],
      }).success,
    ).toBe(true);
  });

  it('a document payment may be 0', () => {
    expect(
      ContractLinkInputSchema.safeParse({
        contractId: 'c1',
        payment: { amount: { amountMinor: 0, currency: 'EUR' }, paidOn: '2026-01-01' },
      }).success,
    ).toBe(true);
  });
});

describe('contract bodies take a master and a schedule; documents a link', () => {
  it('a contract body with parentId and schedule', () => {
    const parsed = FinanceItemBodySchema.safeParse({
      type: 'contract',
      title: 'Dodatok',
      amount: { amountMinor: 720_000, currency: 'EUR' },
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      parentId: 'master-1',
      schedule: { frequency: 'monthly', amountMinor: 60_000, startsOn: '2026-01-01' },
    });
    expect(parsed.success).toBe(true);
  });

  it('a document body with a contract link; a note none', () => {
    expect(
      FinanceItemBodySchema.safeParse({
        type: 'document',
        title: 'Faktúra 1/2026',
        contractLink: { contractId: 'c1' },
      }).success,
    ).toBe(true);
    expect(
      FinanceItemBodySchema.safeParse({
        type: 'note',
        title: 'Poznámka',
        contractLink: { contractId: 'c1' },
      }).success,
    ).toBe(false);
  });
});
