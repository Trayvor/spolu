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

// Phase 30 — meetings.

/** A recording upload that is not audio or video (400 `invalid_recording`). */
export class InvalidRecordingError extends Error {
  constructor() {
    super('Not an audio or video file');
    this.name = 'InvalidRecordingError';
  }
}

/** A recording is still being transcoded (409 `recording_busy`). */
export class RecordingBusyError extends Error {
  constructor() {
    super('A recording is being processed');
    this.name = 'RecordingBusyError';
  }
}

/** An AI run of this meeting is queued or running (409 `meeting_busy`). */
export class MeetingBusyError extends Error {
  constructor() {
    super('The meeting is being processed');
    this.name = 'MeetingBusyError';
  }
}

/** No transcript and no ready recording (400 `nothing_to_process`). */
export class NothingToProcessError extends Error {
  constructor() {
    super('Nothing to process');
    this.name = 'NothingToProcessError';
  }
}

/** The AI a run needs is not configured (503 `ai_unavailable`). */
export class MeetingAiUnavailableError extends Error {
  constructor() {
    super('The meeting AI is not configured');
    this.name = 'MeetingAiUnavailableError';
  }
}

/** A transcript file that is not .txt, .vtt, .srt or a readable .docx (400). */
export class InvalidTranscriptFileError extends Error {
  constructor() {
    super('Invalid transcript file');
    this.name = 'InvalidTranscriptFileError';
  }
}
