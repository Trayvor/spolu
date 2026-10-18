import type { TicketStatus } from '@spolu/shared';
import { plural } from './plural.js';
import type { ServerTexts } from './types.js';

const STATUS: Record<TicketStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

export const en: ServerTexts = {
  intl: 'en-GB',
  email: {
    footer: ['Help by eGrant', 'This email was sent automatically by the Help by eGrant app.'],
  },
  bulkEmail: {
    reason: 'You get this email because you have an account in Help by eGrant.',
    unsubscribe: 'Unsubscribe',
  },
  auth: {
    loginCode: {
      subject: (code) => `Your Help by eGrant login code: ${code}`,
      heading: 'Your login code',
      body: 'It is valid for 5 minutes. If you did not ask for it, ignore this email.',
    },
    adminAdded: {
      subject: 'You were added to Help by eGrant',
      greeting: (name) => `Hello ${name},`,
      body: ({ addedBy, email }) =>
        `${addedBy} added you as an administrator of Help by eGrant. Log in with your email ${email}.`,
      button: 'Log in',
    },
    memberInvited: {
      subject: (group) => `Invitation to Help by eGrant – ${group}`,
      body: ({ invitedBy, groupName, email }) =>
        `${invitedBy} invited you to the group ${groupName} in Help by eGrant. Log in with your email ${email}.`,
      button: 'Log in',
    },
    memberAdded: {
      subject: (group) => `You were added to ${group}`,
      body: ({ addedBy, groupName }) =>
        `${addedBy} added you to the group ${groupName} in Help by eGrant.`,
      button: 'Open the group',
    },
    emailChangeCode: {
      subject: (code) => `Your Help by eGrant email change code: ${code}`,
      heading: 'Your email change code',
      body: (email) =>
        `Enter it in the Help app to change your email to ${email}. It is valid for 5 minutes. If you did not ask for it, ignore this email.`,
    },
    emailChanged: {
      subject: 'Your Help by eGrant email was changed',
      body: (newEmail) =>
        `The email of your Help by eGrant account was changed to ${newEmail}. From now on, log in with the new address.`,
      warning: 'If you did not do this, contact your administrator at once.',
    },
  },
  mcp: {
    tokenCreated: {
      subject: 'A new AI access token was created in Help',
      body: ({ name, date }) =>
        `A new AI access token “${name}” was created in Help by eGrant on ${date}. With it, an AI assistant can read and change data as you.`,
      warning:
        "If this wasn't you, revoke it in Settings (AI access (MCP)) at once and contact your administrator.",
      button: 'Open Settings',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Ticket #${n} created: ${title}`,
      untitled: 'your request',
      received: (n, title) => `We received your support ticket #${n}: ${title}.`,
      followUp:
        'You can follow it and write to eGrant in the Help app. Log in with this email address; we will send you a code.',
      followUpLink:
        'You can follow it and write to eGrant in the Help app. The button signs you in directly, without a code, and works for 7 days. Do not forward this email.',
      button: 'Open the ticket',
    },
  },
  groups: {
    managerAdded: {
      subject: (g) => `You are now a manager of ${g}`,
      body: (g) =>
        `eGrant made you a manager of the client ${g} in Help by eGrant. You will be notified of all its messages until you change that with the bell.`,
      button: 'Open the client',
    },
  },
  notifications: {
    sentFile: (name) => `${name} sent a file`,
    moved: (label) => `Moved to ${label}`,
    movedGeneric: 'Task moved',
    assigned: (name) => `${name} assigned you to this task`,
    deadline: (d) => (d === 1 ? 'Due tomorrow' : `Due in ${d} days`),
    urgent: 'Urgent: still open',
    bucket: (l) => {
      switch (l.kind) {
        case 'todo':
          return 'To do';
        case 'egrant_review':
          return 'eGrant review';
        case 'client_review':
          return `${l.name ?? ''} review`.trim();
        case 'done':
          return 'Completed';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('en', n, { one: 'new message', other: 'new messages' })} in ${g}`,
    digestButton: (g) => `Open ${g}`,
    reminderDue: (time) => `Reminder for ${time}`,
    reminderLine: (title, time) => `Reminder: ${title}, ${time}`,
    deadlineEvent: (title) => `Deadline: ${title}`,
    ticketNew: (n, client) => `New ticket #${n} · ${client}`,
    ticketUnassigned: (n) => `New ticket #${n} without client`,
    ticketStatus: (n, status) => `#${n} is now ${STATUS[status] ?? status}`,
    ticketAssigned: (n) => `You were assigned #${n}`,
    ticketUpdated: (n) => `#${n} was changed`,
    ticketTasks: (n, c) =>
      `#${n} turned into ${c} ${plural('en', c, { one: 'task', other: 'tasks' })}`,
    ticketTopic: (n) => `Ticket #${n}`,
    openTicket: 'Open ticket',
    meetingScheduled: (when) => `New meeting: ${when}`,
    meetingRescheduled: (when) => `Meeting moved to ${when}`,
    meetingSummaryReady: 'AI summary is ready',
    meetingSummaryFailed: 'AI processing failed',
    openMeeting: 'Open meeting',
    contractEnds: (date) => `Contract ends on ${date}`,
    contractLine: (title, client, date) => `Contract ${title} · ${client}: ends on ${date}`,
    openContract: 'Open contract',
    expenseDue: (date) => `Expense due on ${date}`,
    expenseLine: (title, date) => `Expense ${title}: due on ${date}`,
    salaryTitle: (name) => `Salary: ${name}`,
    openExpense: 'Open expense',
    financeTopic: 'Finance',
    timeMissing: 'Fill in how much time you spent',
    timeMissingLine: (title) => `${title}: fill in your time`,
    openTask: 'Open task',
  },
};
