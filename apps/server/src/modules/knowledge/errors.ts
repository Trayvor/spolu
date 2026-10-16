// The knowledge module's expected errors; `routes.ts` maps each to a status and code.

/** The item does not exist or the actor cannot read it (404). */
export class KnowledgeNotFoundError extends Error {
  constructor() {
    super('Knowledge item not found');
    this.name = 'KnowledgeNotFoundError';
  }
}

/** The actor reads the item but may not edit or delete it (403). */
export class KnowledgeForbiddenError extends Error {
  constructor() {
    super('Not allowed to change this knowledge item');
    this.name = 'KnowledgeForbiddenError';
  }
}

/** The item changed since the `updatedAt` being edited (409 `knowledge_changed`). */
export class KnowledgeChangedError extends Error {
  constructor() {
    super('Knowledge item changed');
    this.name = 'KnowledgeChangedError';
  }
}

/** `admins` by a client or on a client's item (400 `invalid_visibility`). */
export class InvalidVisibilityError extends Error {
  constructor() {
    super('Invalid visibility');
    this.name = 'InvalidVisibilityError';
  }
}

/** Not an http(s) URL of at most 2048 characters, or a URL on a non-link item (400 `invalid_url`). */
export class InvalidUrlError extends Error {
  constructor() {
    super('Invalid URL');
    this.name = 'InvalidUrlError';
  }
}

/** A malformed cursor, or a patch that tries to change the type (400 `validation`). */
export class ValidationError extends Error {
  constructor(message = 'Invalid request') {
    super(message);
    this.name = 'ValidationError';
  }
}

/** The folder does not exist, is in another group, or the actor cannot see it (404). */
export class KnowledgeFolderNotFoundError extends Error {
  constructor() {
    super('Knowledge folder not found');
    this.name = 'KnowledgeFolderNotFoundError';
  }
}

/** A folder moved into itself or below itself (400 `invalid_folder`). */
export class InvalidFolderError extends Error {
  constructor() {
    super('Invalid folder');
    this.name = 'InvalidFolderError';
  }
}

/** The group already has the most folders allowed (400 `folder_limit`). */
export class FolderLimitError extends Error {
  constructor() {
    super('Too many folders');
    this.name = 'FolderLimitError';
  }
}
