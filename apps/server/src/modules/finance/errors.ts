/** The documents' expected errors (part B); `documents-routes.ts` maps them to HTTP answers. */

/** An unknown item or folder, or one of another client than the path's (404). */
export class FinanceNotFoundError extends Error {
  constructor(what = 'Finance item') {
    super(`${what} not found`);
    this.name = 'FinanceNotFoundError';
  }
}

/** The item changed since the editor loaded it (`409 finance_changed`). */
export class FinanceChangedError extends Error {
  constructor() {
    super('The finance item changed meanwhile');
    this.name = 'FinanceChangedError';
  }
}

/** A body the schema let through but the item refuses: contract fields on a note, a period that ends before it starts (400). */
export class FinanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceValidationError';
  }
}

/** A folder move that would make a cycle (`400 invalid_folder`). */
export class FinanceFolderCycleError extends Error {
  constructor() {
    super('A folder cannot move into itself');
    this.name = 'FinanceFolderCycleError';
  }
}

/** A client has the most folders allowed (`400 folder_limit`). */
export class FinanceFolderLimitError extends Error {
  constructor() {
    super('Too many folders');
    this.name = 'FinanceFolderLimitError';
  }
}

/** A contract of several clients names the admin group as a client (Phase 34 part E, `400 invalid_group`). */
export class FinanceAdminGroupShareError extends Error {
  constructor() {
    super('The admin group has no share of a contract');
    this.name = 'FinanceAdminGroupShareError';
  }
}

/**
 * A master contract the rules refuse (ADR 0066, `400 invalid_parent`): not a contract, itself, a
 * contract that has a master already, a contract that is a master getting one, or a master that
 * does not cover the contract's clients.
 */
export class FinanceParentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceParentError';
  }
}

/** A payment schedule that yields no payment or too many (`400 invalid_schedule`). */
export class FinanceScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceScheduleError';
  }
}

/**
 * A document link the rules refuse (`400 invalid_contract`): no such contract, a contract of
 * another client, a payment in another currency.
 */
export class FinanceContractLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceContractLinkError';
  }
}
