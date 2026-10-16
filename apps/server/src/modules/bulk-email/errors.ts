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
