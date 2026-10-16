/** A time id that is unknown, a fired time whose `at` changed, a time too far ahead, or more than 20 unfired times (400 `invalid_reminder`). */
export class InvalidReminderError extends Error {
  constructor(message = 'Invalid reminder') {
    super(message);
    this.name = 'InvalidReminderError';
  }
}

/** A new or changed time is less than one minute ahead (400 `reminder_in_past`). */
export class ReminderInPastError extends Error {
  constructor() {
    super('Reminder time is in the past');
    this.name = 'ReminderInPastError';
  }
}

/** A recipient is not a person of the group, not an admin on an admins-only subject, or there are more than 50 (400 `invalid_recipient`). */
export class InvalidRecipientError extends Error {
  constructor() {
    super('Invalid recipient');
    this.name = 'InvalidRecipientError';
  }
}

/** The author cannot leave their own reminder (400 `author_recipient`). */
export class AuthorRecipientError extends Error {
  constructor() {
    super('The author cannot unsubscribe');
    this.name = 'AuthorRecipientError';
  }
}

/** The subject does not exist, has no reminders, or the actor cannot read it (404). */
export class NotReadableError extends Error {
  constructor() {
    super('Not found');
    this.name = 'NotReadableError';
  }
}

/** The subject is readable but has no reminder set to subscribe to (404 `no_reminder_set`). */
export class NoReminderSetError extends Error {
  constructor() {
    super('No reminder set');
    this.name = 'NoReminderSetError';
  }
}
