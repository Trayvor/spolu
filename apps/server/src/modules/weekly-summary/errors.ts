import type { SummaryRow } from './service.js';

/** The row changed since the caller read it (`version`): answered 409 with the current one. */
export class StaleVersionError extends Error {
  constructor(readonly current: SummaryRow) {
    super('The summary changed meanwhile');
    this.name = 'StaleVersionError';
  }
}

/** Only a draft can be edited, regenerated, restored, skipped or sent. */
export class NotDraftError extends Error {
  constructor() {
    super('The summary is not a draft');
    this.name = 'NotDraftError';
  }
}

/** Some refs left the group before Send: those items were dropped and the row saved. */
export class RefsChangedError extends Error {
  constructor(readonly current: SummaryRow) {
    super('Some items no longer belong to the group');
    this.name = 'RefsChangedError';
  }
}

export class NoRecipientsError extends Error {
  constructor() {
    super('The group has nobody to send the summary to');
    this.name = 'NoRecipientsError';
  }
}

/** A deactivated group's draft is read-only: it is never sent. */
export class SummaryGroupInactiveError extends Error {
  constructor() {
    super('The group is deactivated');
    this.name = 'SummaryGroupInactiveError';
  }
}
