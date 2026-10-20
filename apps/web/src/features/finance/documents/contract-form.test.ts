import { describe, expect, it } from 'vitest';
import type { FinanceItemDetail } from '@spolu/shared';
import {
  contractErrors,
  contractValueOf,
  emptyContractValue,
  linkInput,
  scheduleInput,
  scheduleSummaryKey,
  storedScheduleInput,
} from './contract-form';

/** Contracts v2: the form's schedule and a document's link. */
const base = () => ({ ...emptyContractValue() });

describe('the schedule in the contract form', () => {
  it('none sends null and checks nothing', () => {
    expect(scheduleInput(base(), 'EUR')).toBeNull();
    expect(contractErrors('contract', base(), 'EUR')).toEqual({});
  });

  it('monthly needs an amount (0 allowed) and a first day; the end is optional', () => {
    const v = { ...base(), scheduleFrequency: 'monthly' as const };
    expect(contractErrors('contract', v, 'EUR')).toEqual({
      scheduleAmount: 'amount',
      scheduleStartsOn: 'scheduleStart',
    });
    const ok = { ...v, scheduleAmount: '0', scheduleStartsOn: '2026-01-31' };
    expect(contractErrors('contract', ok, 'EUR')).toEqual({});
    expect(scheduleInput(ok, 'EUR')).toEqual({
      frequency: 'monthly',
      everyMonths: null,
      amountMinor: 0,
      startsOn: '2026-01-31',
      endsOn: null,
    });
    expect(contractErrors('contract', { ...ok, scheduleEndsOn: '2025-12-31' }, 'EUR')).toEqual({
      scheduleEndsOn: 'scheduleEnd',
    });
  });

  it('every N months checks N; custom days are sorted, each once', () => {
    const every = {
      ...base(),
      scheduleFrequency: 'everyMonths' as const,
      scheduleAmount: '600,50',
      scheduleStartsOn: '2026-01-01',
      scheduleEvery: '0',
    };
    expect(contractErrors('contract', every, 'EUR')).toEqual({ scheduleEvery: 'everyMonths' });
    expect(scheduleInput({ ...every, scheduleEvery: '5' }, 'EUR')).toMatchObject({
      everyMonths: 5,
      amountMinor: 60_050,
    });
    const dates = {
      ...base(),
      scheduleFrequency: 'dates' as const,
      scheduleAmount: '100',
      scheduleDates: ['2026-06-30', '', '2026-03-15'],
    };
    expect(scheduleInput(dates, 'EUR')).toEqual({
      frequency: 'dates',
      dates: ['2026-03-15', '2026-06-30'],
      amountMinor: 10_000,
    });
    expect(
      contractErrors('contract', { ...dates, scheduleDates: ['2026-01-01', '2026-01-01'] }, 'EUR'),
    ).toEqual({ scheduleDates: 'dates' });
  });

  it('a loaded schedule round-trips unchanged', () => {
    const item = {
      contract: { parentId: 'm1' },
      schedule: {
        frequency: 'quarterly',
        everyMonths: 3,
        amount: { amountMinor: 30_000, currency: 'EUR' },
        startsOn: '2026-01-01',
        endsOn: null,
        dates: null,
      },
    } as unknown as FinanceItemDetail;
    const v = contractValueOf(item, (m) => String(m / 100));
    expect(v.parentId).toBe('m1');
    expect(JSON.stringify(scheduleInput(v, 'EUR'))).toBe(
      JSON.stringify(storedScheduleInput(item.schedule)),
    );
    expect(scheduleSummaryKey({ frequency: 'everyMonths', everyMonths: 4 })).toEqual({
      key: 'everyMonths',
      count: 4,
    });
  });
});

describe("a document's contract link", () => {
  it('without a payment, with one, and a payment needs its day', () => {
    const v = { ...base(), linkContractId: 'c1' };
    expect(linkInput(v, 'EUR')).toEqual({ contractId: 'c1', payment: null });
    expect(contractErrors('document', { ...v, linkAmount: '600' }, 'EUR')).toEqual({
      linkPaidOn: 'paidOn',
    });
    expect(linkInput({ ...v, linkAmount: '600', linkPaidOn: '2026-01-10' }, 'EUR')).toEqual({
      contractId: 'c1',
      payment: { amount: { amountMinor: 60_000, currency: 'EUR' }, paidOn: '2026-01-10' },
    });
    expect(linkInput(base(), 'EUR')).toBeNull();
  });
});
