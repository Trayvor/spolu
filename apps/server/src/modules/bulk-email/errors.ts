import type { BulkNotReadyProblem } from '@spolu/shared';

/** Expected failures of the bulk email services; `routes.ts` maps each to its answer. */

export class CampaignNotFoundError extends Error {
  constructor() {
    super('No such campaign');
    this.name = 'CampaignNotFoundError';
  }
}

/** The draft was saved by someone else since `version` was read (`409 changed`). */
export class CampaignChangedError extends Error {
  constructor() {
    super('The campaign changed since it was read');
    this.name = 'CampaignChangedError';
  }
}

/** Only a draft can be edited or deleted (`409 not_draft`). */
export class NotDraftError extends Error {
  constructor() {
    super('The campaign is not a draft');
    this.name = 'NotDraftError';
  }
}

/** A page cursor that this server did not make (`400 validation_failed`). */
export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

/** Only a campaign that is sending can be cancelled (`409 not_sending`). */
export class NotSendingError extends Error {
  constructor() {
    super('The campaign is not sending');
    this.name = 'NotSendingError';
  }
}

/** The campaign misses something it needs to be sent (`400 not_ready` with the problems). */
export class NotReadyError extends Error {
  constructor(readonly problems: BulkNotReadyProblem[]) {
    super('The campaign is not ready to send');
    this.name = 'NotReadyError';
  }
}

/** Nobody would get the campaign (`400 empty_audience`); it stays a draft. */
export class EmptyAudienceError extends Error {
  constructor() {
    super('The audience is empty');
    this.name = 'EmptyAudienceError';
  }
}
