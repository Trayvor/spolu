import type { BucketLabel, TicketStatus } from '@spolu/shared';

/** A count's plural form: what `Intl.PluralRules(<language>).select(n)` returns. */
export type PluralForm = Intl.LDMLPluralRule;

/**
 * Every text the server writes, in one language: system emails, push notifications, digests,
 * the calendar export and the footers. One file per language in this folder
 * (`<code>.ts`), all of this type, so a missing text is a type error. The web texts are in
 * `apps/web/src/locales/`.
 *
 * Email texts are plain text: the renderer escapes them and makes http(s) links clickable.
 * Brand names stay as they are: "Help", "Help by eGrant", "eGrant".
 */
export type ServerTexts = {
  /** The language's BCP 47 tag for `Intl` dates (e.g. `sk-SK`, `en-GB`). */
  intl: string;
  email: {
    /** The small print under every system email (no unsubscribe: they are transactional). */
    footer: string[];
  };
  bulkEmail: {
    /** The bulk email footer: why the person gets it, and the unsubscribe link's text. */
    reason: string;
    unsubscribe: string;
  };
  auth: {
    loginCode: {
      subject(code: string): string;
      heading: string;
      /** Shown under the code. */
      body: string;
    };
    adminAdded: {
      subject: string;
      greeting(name: string): string;
      body(p: { addedBy: string; email: string }): string;
      button: string;
    };
    /** An admin invited a person who has not signed in yet to a group. */
    memberInvited: {
      subject(groupName: string): string;
      body(p: { invitedBy: string; groupName: string; email: string }): string;
      button: string;
    };
    /** An admin added a signed-in client to one more group. */
    memberAdded: {
      subject(groupName: string): string;
      body(p: { addedBy: string; groupName: string }): string;
      button: string;
    };
    /** The code that confirms a new email address; sent to that new address. */
    emailChangeCode: {
      subject(code: string): string;
      heading: string;
      /** Shown under the code; `email` is the new address. */
      body(email: string): string;
    };
    /** Tells the old address that the account's email changed. */
    emailChanged: {
      subject: string;
      body(newEmail: string): string;
      warning: string;
    };
    /** The code that re-checks a stale session before a passkey is added (ADR 0050). */
    passkeyCode: {
      subject(code: string): string;
      heading: string;
      body: string;
    };
    /** To an admin when a passkey was added to their account (an alert in case it was not them). */
    passkeyAdded: {
      subject: string;
      /** `date` is when it was added, formatted in the language (Bratislava time). */
      body(p: { name: string; date: string }): string;
      /** Asks to delete it in Settings if it was not them. */
      warning: string;
      button: string;
    };
  };
  mcp: {
    /** To a token's owner when it is made (an alert in case it was not them). */
    tokenCreated: {
      subject: string;
      /** `date` is when it was made, formatted in the language (Bratislava time). */
      body(p: { name: string; date: string }): string;
      /** Asks to revoke it in Settings if it was not them. */
      warning: string;
      button: string;
    };
    /** An OAuth client (a Claude custom connector) was approved (ADR 0034). */
    connectionApproved: {
      subject: string;
      /** `host`: where the client returns (claude.ai); `date` as for tokenCreated. */
      body(p: { name: string; host: string; date: string }): string;
      warning: string;
      button: string;
    };
  };
  tickets: {
    /** "Ticket created" to the ticket's initiator. */
    created: {
      subject(number: number, title: string): string;
      /** The title when the ticket has no subject. */
      untitled: string;
      received(number: number, title: string): string;
      /** Asks to sign in with a code (an admin's or a group client's email). */
      followUp: string;
      /** Says the button signs in without a code (a ziadatel's email, ADR 0022). */
      followUpLink: string;
      button: string;
    };
  };
  notifications: {
    sentFile(name: string): string;
    moved(label: string): string;
    movedGeneric: string;
    assigned(name: string): string;
    /** `daysLeft` is 1, 2 or 3. */
    deadline(daysLeft: number): string;
    urgent: string;
    bucket(label: BucketLabel): string;
    digestSubject(count: number, group: string): string;
    digestButton(group: string): string;
    reminderDue(time: string): string;
    reminderLine(title: string, time: string): string;
    /** The SUMMARY of a task's all-day deadline event in the calendar export. */
    deadlineEvent(title: string): string;
    /** Ticket notifications (Phase 21): push titles, the digest topic and button. */
    ticketNew(number: number, client: string): string;
    ticketUnassigned(number: number): string;
    ticketStatus(number: number, status: TicketStatus): string;
    /** A person became a riešiteľ (assignee) of the ticket. */
    ticketAssigned(number: number): string;
    ticketUpdated(number: number): string;
    ticketTasks(number: number, count: number): string;
    ticketTopic(number: number): string;
    openTicket: string;
    /** A meeting was created; `when` is its start, e.g. "Thu 22 Oct, 10:00" (Bratislava). */
    meetingScheduled(when: string): string;
    /** A meeting's start moved to `when`. */
    meetingRescheduled(when: string): string;
    /** To the admin who started "Spracovať s AI": the summary is there, or the run failed. */
    meetingSummaryReady: string;
    meetingSummaryFailed: string;
    /** The digest email's button for a meeting. */
    openMeeting: string;
    /** A finance contract's reminder (Phase 32): its push body; `date` is its last day. */
    contractEnds(date: string): string;
    /** The digest line of a contract's reminder. */
    contractLine(title: string, client: string, date: string): string;
    /** The digest email's button for a contract. */
    openContract: string;
    /** An expense's reminder (Phase 32 E): its push body; `date` is the expense's date. */
    expenseDue(date: string): string;
    /** The digest line of an expense's reminder. */
    expenseLine(title: string, date: string): string;
    /** A salary's title in a push and a digest line: "Salary: Eva Nováková". */
    salaryTitle(name: string): string;
    /** The digest email's button for an expense. */
    openExpense: string;
    /** The topic of a finance email of no client (the organisation's items): "Finance". */
    financeTopic: string;
    /** Phase 32: a time request's push body ("Fill in how much time you spent"). */
    timeMissing: string;
    /** Its digest line: "<title>: fill in your time". */
    timeMissingLine(title: string): string;
    /** The digest button of a time request on a task. */
    openTask: string;
    /**
     * Digest subjects (2026-10-18). `digestSubject` (above) is for messages of one place, "3 new
     * messages – Firma"; this one for other changes of one place: "Ticket #12: 2 updates".
     */
    digestUpdates(count: number, topic: string): string;
    /** Several places in one email: "5 updates: Ticket #12, Firma and 3 more" (two topics named). */
    digestMany(count: number, topics: string[], more: number): string;
    /** Under the sections when the email leaves places out: "And 2 more in Help." */
    digestMore(count: number): string;
    /** A task's due date changed (`date` as `formatDay` writes it), or was removed. */
    dueChanged(date: string): string;
    dueRemoved: string;
    /** An open task is past its due date `date`. */
    overdue(date: string): string;
    /** The push title of a resolved ticket. */
    ticketResolved(number: number): string;
    /** F16: the push body of a mention in a description ("Jana mentioned you in the description"). */
    mentionedInDescription(name: string): string;
    /** The digest email's button for a knowledge item and for a project (F16). */
    openKnowledge: string;
    openProject: string;
    /** N6a push buttons (ADR 0047): "Done" on a task, "Log time" on a time request, "Reply". */
    actionDone: string;
    actionLogTime: string;
    actionReply: string;
    /** The inline reply field's placeholder, where the platform has one. */
    replyPlaceholder: string;
  };
  /** Microsoft Teams (T1): the invitation's and the public calendar page's notices. */
  teams: {
    /** Help switched on automatic recording and transcription (owner answer 3). */
    recordingNotice: string;
    /** Automatic recording is off, but someone may start it in the call. */
    recordingMayNotice: string;
    /** Before the public add-to-calendar link in the invitation. */
    addToCalendar: string;
    /** Before the join link in the .ics description. */
    join: string;
  };
  /** The weekly client summary email and the managers' reminder (spec 2026-10-19 §8.1, §12.7). */
  weeklySummary: {
    /** `range` is the window as text, e.g. `13. 10. – 17. 10. 2026`. */
    subject(group: string, range: string): string;
    heading: string;
    /** The three section headings. */
    done: string;
    waiting: string;
    upcoming: string;
    /** Opens the group in Help. */
    button: string;
    /** The intro and closing of the draft built without AI (in the draft's language). */
    factsIntro(range: string): string;
    factsClosing: string;
    /** The footer line with the personal unsubscribe link. */
    footer(group: string, url: string): string;
    /** Before the subject of a test email; the same in every language. */
    testPrefix: string;
    /** To a manager on Friday: drafts are ready (`more`: groups beyond the named ones). */
    reminder: {
      subject(n: number): string;
      body(groups: string[], more: number): string;
      button: string;
    };
  };
};
