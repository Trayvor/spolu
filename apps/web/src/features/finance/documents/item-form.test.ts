import { beforeEach, describe, expect, it } from 'vitest';
import type { FinanceItemDetail } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { localToIso } from '@/features/reminders/reminder-times-field';
import { addDays, formatPeriod, hasEnded, isEndingSoon, proposedReminder } from './format';
import {
  amountText,
  emptyItemValue,
  fromItem,
  timesToSave,
  toBody,
  toPatch,
  validateItem,
  type ItemFormValue,
} from './item-form';

const t = (key: string) => i18n.t(key);

const contract: FinanceItemDetail = {
  id: 'f1',
  groupId: 'g1',
  type: 'contract',
  folderId: null,
  title: 'Zmluva',
  contract: {
    contractNumber: 'Z-1',
    amount: { amountMinor: 1_200_050, currency: 'EUR' },
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
    shared: null,
  },
  fileCount: 0,
  expense: null,
  hasUpcomingReminder: false,
  createdBy: 'u1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  body: '',
  files: [],
  createdByName: 'Eva',
};

const value = (over: Partial<ItemFormValue> = {}): ItemFormValue => ({
  ...emptyItemValue(),
  title: 'Zmluva',
  amount: '12 000',
  startsOn: '2026-01-01',
  endsOn: '2026-12-31',
  ...over,
});

describe('finance documents: dates', () => {
  it('formats a period and tells "ending soon" (60 days) and "ended"', async () => {
    await setLanguage('sk');
    expect(formatPeriod('2026-01-01', '2026-12-31', 'sk')).toBe('1. 1. 2026 – 31. 12. 2026');
    expect(isEndingSoon('2026-12-01', '2026-10-17')).toBe(true);
    expect(isEndingSoon('2026-12-17', '2026-10-17')).toBe(false);
    expect(isEndingSoon('2026-10-16', '2026-10-17')).toBe(false);
    expect(hasEnded('2026-10-16', '2026-10-17')).toBe(true);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('proposes a reminder 30 days before the end at 09:00, never in the past', () => {
    const now = new Date('2026-10-17T10:00:00Z');
    expect(proposedReminder('2026-12-31', now)).toEqual({ date: '2026-12-01', time: '09:00' });
    expect(proposedReminder('2026-11-10', now)).toBeNull();
    expect(proposedReminder('', now)).toBeNull();
  });
});

describe('finance documents: the item form', () => {
  beforeEach(async () => {
    await setLanguage('en');
  });

  it('a contract needs its title, a valid amount and a period in order', () => {
    expect(validateItem('contract', value(), t)).toEqual({});
    const bad = validateItem(
      'contract',
      value({ title: ' ', amount: '12,5,5', startsOn: '2026-05-01', endsOn: '2026-04-30' }),
      t,
    );
    expect(Object.keys(bad).sort()).toEqual(['amount', 'endsOn', 'title']);
    expect(bad.endsOn).toBe('The period cannot end before it starts.');
    expect(validateItem('contract', value({ startsOn: '', endsOn: '' }), t)).toMatchObject({
      startsOn: 'Choose the first day.',
      endsOn: 'Choose the last day.',
    });
    // A note has no contract fields to check.
    expect(validateItem('note', value({ amount: '' }), t)).toEqual({});
  });

  it('builds the create body: money in minor units, an empty number as null', () => {
    expect(toBody('contract', value({ amount: '1 200,50' }), 'f9')).toEqual({
      type: 'contract',
      title: 'Zmluva',
      body: '',
      folderId: 'f9',
      fileIds: [],
      contractNumber: null,
      amount: { amountMinor: 120_050, currency: 'EUR' },
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      projectId: null,
    });
    expect(toBody('note', value(), null)).toEqual({
      type: 'note',
      title: 'Zmluva',
      body: '',
      folderId: null,
      fileIds: [],
    });
  });

  it('an edit sends only what changed, with its updatedAt', () => {
    const loaded = fromItem(contract, 'sk');
    expect(loaded.amount).toBe('12000,50');
    expect(amountText(1_200_000, 'EUR', 'en')).toBe('12000');
    expect(toPatch(contract, loaded)).toEqual({ updatedAt: contract.updatedAt });
    expect(
      toPatch(contract, { ...loaded, amount: '15 000', endsOn: '2027-01-31', contractNumber: '' }),
    ).toEqual({
      updatedAt: contract.updatedAt,
      amount: { amountMinor: 1_500_000, currency: 'EUR' },
      endsOn: '2027-01-31',
      contractNumber: null,
    });
  });

  it('saves only future reminder times after a create', () => {
    const now = new Date('2026-10-17T10:00:00Z');
    const rows = [
      { key: 'a', date: '2026-12-01', time: '09:00', firedAt: null },
      { key: 'b', date: '2026-01-01', time: '09:00', firedAt: null },
      { key: 'c', date: '', time: '09:00', firedAt: null },
    ];
    expect(timesToSave(rows, now)).toEqual([{ at: localToIso('2026-12-01', '09:00') }]);
  });
});
