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
  };
  tickets: {
    /** "Ticket created" to the ticket's initiator. */
    created: {
      subject(number: number, title: string): string;
      /** The title when the ticket has no subject. */
      untitled: string;
      received(number: number, title: string): string;
      followUp: string;
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
  };
};
