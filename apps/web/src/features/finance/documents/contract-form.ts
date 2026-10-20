import {
  parseMoney,
  SCHEDULE_LIMITS,
  type ContractLinkInput,
  type ContractSchedule,
  type Currency,
  type FinanceItemDetail,
  type ScheduleFrequency,
  type ScheduleInput,
} from '@spolu/shared';

/**
 * Contracts v2 (ADR 0066): the form's master, payment schedule and a document's contract, as
 * text the way people type it, and the pure helpers that read, check and send them.
 */

export type ScheduleChoice = 'none' | ScheduleFrequency;

export type ContractFormValue = {
  /** A contract's master contract, or null. */
  parentId: string | null;
  scheduleFrequency: ScheduleChoice;
  /** "Every N months": N as typed. */
  scheduleEvery: string;
  /** The amount per payment as typed. */
  scheduleAmount: string;
  scheduleStartsOn: string;
  scheduleEndsOn: string;
  /** A custom list of days (date inputs; empty rows are ignored). */
  scheduleDates: string[];
  /** A document's contract, or null. */
  linkContractId: string | null;
  /** The payment the document records, as typed (empty: none), and its day. */
  linkAmount: string;
  linkPaidOn: string;
};

export type ContractFormErrorKey =
  | 'scheduleAmount'
  | 'scheduleEvery'
  | 'scheduleStartsOn'
  | 'scheduleEndsOn'
  | 'scheduleDates'
  | 'linkAmount'
  | 'linkPaidOn';

export function emptyContractValue(): ContractFormValue {
  return {
    parentId: null,
    scheduleFrequency: 'none',
    scheduleEvery: '2',
    scheduleAmount: '',
    scheduleStartsOn: '',
    scheduleEndsOn: '',
    scheduleDates: [''],
    linkContractId: null,
    linkAmount: '',
    linkPaidOn: '',
  };
}

/** The form's values of an existing contract or document. */
export function contractValueOf(
  item: FinanceItemDetail,
  amountText: (minor: number, currency: Currency) => string,
): ContractFormValue {
  const value = emptyContractValue();
  value.parentId = item.contract?.parentId ?? null;
  const s: ContractSchedule | null | undefined = item.schedule;
  if (s) {
    value.scheduleFrequency = s.frequency;
    value.scheduleEvery = String(s.everyMonths ?? 2);
    value.scheduleAmount = amountText(s.amount.amountMinor, s.amount.currency);
    value.scheduleStartsOn = s.frequency === 'dates' ? '' : s.startsOn;
    value.scheduleEndsOn = s.endsOn ?? '';
    value.scheduleDates = s.dates && s.dates.length > 0 ? [...s.dates] : [''];
  }
  const link = item.contractLink;
  if (link) {
    value.linkContractId = link.contract.id;
    value.linkAmount = link.payment
      ? amountText(link.payment.amount.amountMinor, link.payment.amount.currency)
      : '';
    value.linkPaidOn = link.payment?.paidOn ?? '';
  }
  return value;
}

const datesOf = (value: ContractFormValue) => value.scheduleDates.filter((d) => d !== '').sort();

/** The schedule's field errors (keys of `financeDocuments.contracts.errors.*`). */
export function contractErrors(
  type: 'contract' | 'document' | string,
  value: ContractFormValue,
  currency: Currency,
): Partial<Record<ContractFormErrorKey, string>> {
  const errors: Partial<Record<ContractFormErrorKey, string>> = {};
  if (type === 'contract' && value.scheduleFrequency !== 'none') {
    if (!parseMoney(value.scheduleAmount, currency)) errors.scheduleAmount = 'amount';
    if (value.scheduleFrequency === 'dates') {
      const dates = datesOf(value);
      if (dates.length === 0 || new Set(dates).size !== dates.length) {
        errors.scheduleDates = 'dates';
      } else if (dates.length > SCHEDULE_LIMITS.maxDates) errors.scheduleDates = 'tooManyDates';
    } else {
      if (value.scheduleFrequency === 'everyMonths') {
        const n = Number(value.scheduleEvery);
        if (!Number.isInteger(n) || n < 1 || n > SCHEDULE_LIMITS.maxEveryMonths) {
          errors.scheduleEvery = 'everyMonths';
        }
      }
      if (!value.scheduleStartsOn) errors.scheduleStartsOn = 'scheduleStart';
      else if (value.scheduleEndsOn && value.scheduleEndsOn < value.scheduleStartsOn) {
        errors.scheduleEndsOn = 'scheduleEnd';
      }
    }
  }
  if (type === 'document' && value.linkContractId) {
    const hasAmount = value.linkAmount.trim() !== '';
    if (hasAmount && !parseMoney(value.linkAmount, currency)) errors.linkAmount = 'paymentAmount';
    if (hasAmount && !value.linkPaidOn) errors.linkPaidOn = 'paidOn';
    if (!hasAmount && value.linkPaidOn) errors.linkAmount = 'paymentAmount';
  }
  return errors;
}

/** The schedule a valid form sends (null: none). */
export function scheduleInput(value: ContractFormValue, currency: Currency): ScheduleInput | null {
  if (value.scheduleFrequency === 'none') return null;
  const amountMinor = parseMoney(value.scheduleAmount, currency)!.amountMinor;
  if (value.scheduleFrequency === 'dates') {
    return { frequency: 'dates', dates: datesOf(value), amountMinor };
  }
  return {
    frequency: value.scheduleFrequency,
    everyMonths: value.scheduleFrequency === 'everyMonths' ? Number(value.scheduleEvery) : null,
    amountMinor,
    startsOn: value.scheduleStartsOn,
    endsOn: value.scheduleEndsOn || null,
  };
}

/** The contract link a valid form sends (null: none). */
export function linkInput(value: ContractFormValue, currency: Currency): ContractLinkInput | null {
  if (!value.linkContractId) return null;
  const amount = value.linkAmount.trim() === '' ? null : parseMoney(value.linkAmount, currency);
  return {
    contractId: value.linkContractId,
    payment: amount ? { amount, paidOn: value.linkPaidOn } : null,
  };
}

/** The schedule as the item holds it, in the shape the form sends, to compare an edit. */
export function storedScheduleInput(schedule: ContractSchedule | null | undefined) {
  if (!schedule) return null;
  if (schedule.frequency === 'dates') {
    return {
      frequency: 'dates',
      dates: schedule.dates ?? [],
      amountMinor: schedule.amount.amountMinor,
    };
  }
  return {
    frequency: schedule.frequency,
    everyMonths: schedule.frequency === 'everyMonths' ? schedule.everyMonths : null,
    amountMinor: schedule.amount.amountMinor,
    startsOn: schedule.startsOn,
    endsOn: schedule.endsOn,
  };
}

/** The link as the item holds it, in the shape the form sends. */
export function storedLinkInput(item: FinanceItemDetail) {
  const link = item.contractLink;
  if (!link) return null;
  return {
    contractId: link.contract.id,
    payment: link.payment ? { amount: link.payment.amount, paidOn: link.payment.paidOn } : null,
  };
}

/**
 * The schedule in one line, "+600 € every month": the key of `financeDocuments.contracts.every.*`
 * and its values.
 */
export function scheduleSummaryKey(s: {
  frequency: ScheduleFrequency;
  everyMonths: number | null;
  dates?: readonly string[] | null;
}): { key: string; count?: number } {
  if (s.frequency === 'everyMonths') return { key: 'everyMonths', count: s.everyMonths ?? 1 };
  if (s.frequency === 'dates') return { key: 'dates', count: s.dates?.length ?? 0 };
  return { key: s.frequency };
}
