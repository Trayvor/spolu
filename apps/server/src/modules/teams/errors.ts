// The teams module's expected errors; `routes.ts` maps each to a status and code.

/** The admin's Microsoft account is unknown or not in the organizers group (403). */
export class TeamsNotOrganizerError extends Error {
  constructor() {
    super('Not a Teams organizer');
    this.name = 'TeamsNotOrganizerError';
  }
}

/** The pasted text is no Teams meeting link (400). */
export class TeamsInvalidLinkError extends Error {
  constructor() {
    super('Not a Teams meeting link');
    this.name = 'TeamsInvalidLinkError';
  }
}

/** The meeting belongs to another tenant or to personal Teams (400). */
export class TeamsOutsideTenantError extends Error {
  constructor() {
    super('Teams meeting outside the tenant');
    this.name = 'TeamsOutsideTenantError';
  }
}

/** The meeting's organizer is none of Help's admins (400). */
export class TeamsUnknownOrganizerError extends Error {
  constructor() {
    super('Teams meeting of an unknown organizer');
    this.name = 'TeamsUnknownOrganizerError';
  }
}

/** None of the known organizers sees the meeting (404 `teams_meeting_not_found`). */
export class TeamsMeetingNotFoundError extends Error {
  constructor() {
    super('Teams meeting not found');
    this.name = 'TeamsMeetingNotFoundError';
  }
}

/** The meeting item is already connected to a Teams meeting (409). */
export class TeamsLinkedError extends Error {
  constructor() {
    super('Already connected to Teams');
    this.name = 'TeamsLinkedError';
  }
}

/** Graph failed in a way the admin cannot fix in Help (502 `teams_unavailable`). */
export class TeamsUnavailableError extends Error {
  constructor(readonly code: string) {
    super(`Microsoft Graph unavailable: ${code}`);
    this.name = 'TeamsUnavailableError';
  }
}
