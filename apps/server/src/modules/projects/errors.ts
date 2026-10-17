/** Expected failures of the projects module; the routes map each to a status and code. */

/** An unknown project or event (404 `not_found`). */
export class ProjectNotFoundError extends Error {
  constructor() {
    super('Project or event not found');
    this.name = 'ProjectNotFoundError';
  }
}

/** The project or event changed since the caller read it (409 `project_changed`). */
export class ProjectChangedError extends Error {
  constructor() {
    super('Project changed');
    this.name = 'ProjectChangedError';
  }
}

/** Another project of the client has this name or alias (409 `project_name_taken`). */
export class ProjectNameTakenError extends Error {
  constructor(readonly otherName: string) {
    super('Project name taken');
    this.name = 'ProjectNameTakenError';
  }
}

/**
 * A `{ projectId, eventId }` pair that does not fit a write (400 `invalid_project`): a project of
 * another client, an event of another project, or an event without its project.
 */
export class InvalidProjectError extends Error {
  constructor() {
    super('Invalid project or event');
    this.name = 'InvalidProjectError';
  }
}

/** A request the data does not allow (400 `validation_failed`), e.g. removing the current name. */
export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectValidationError';
  }
}

/** Thrown by the stubs of the parts not built yet (plan, "Interfaces between the parts"). */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`);
    this.name = 'NotImplementedError';
  }
}
