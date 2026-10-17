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
