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
    passkeyCode: {
      subject: (code) => `Your Help by eGrant code to add a passkey: ${code}`,
      heading: 'Your code to add a passkey',
      body: 'Enter it in the Help app to add a passkey to your account. It is valid for 5 minutes. If you did not ask for it, ignore this email.',
    },
    passkeyAdded: {
      subject: 'A new passkey was added to your Help account',
      body: ({ name, date }) =>
        `A new passkey “${name}” was added to your Help by eGrant account on ${date}. With it, you can log in without an email code.`,
      warning:
        "If this wasn't you, delete it at once in Settings → Passkeys and contact your administrator.",
      button: 'Open Settings',
    },
  },
  mcp: {
    tokenCreated: {
      subject: 'A new AI access token was created in Help',
      body: ({ name, date }) =>
        `A new AI access token “${name}” was created in Help by eGrant on ${date}. With it, an AI assistant can read and change data as you.`,
      warning:
        "If this wasn't you, revoke it at once in Settings → AI access (MCP) and contact your administrator.",
      button: 'Open Settings',
    },
    connectionApproved: {
      subject: 'An AI assistant was connected to Help',
      body: ({ name, host, date }) =>
        `“${name}” (returning to ${host}) was connected to Help by eGrant on ${date}. It can now use Help as you, with the access you chose.`,
      warning:
        "If this wasn't you, disconnect it at once in Settings → AI access (MCP) and contact your administrator.",
      button: 'Open Settings',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Ticket #${n} created: ${title}`,
      untitled: 'your request',
      received: (n, title) => `We received your ticket #${n}: ${title}.`,
      followUp:
        'You can follow it and write to eGrant in the Help app. Log in with this email address; we will send you a code.',
      followUpLink:
        'You can follow it and write to eGrant in the Help app. The button signs you in directly, without a code, and works for 7 days. Do not forward this email.',
      button: 'Open the ticket',
    },
  },
  notifications: {
    sentFile: (name) => `${name} sent a file`,
    moved: (label) => `Moved to the “${label}” column`,
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
          return `${l.name ?? 'Client'} review`;
        case 'done':
          return 'Done';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('en', n, { one: 'new message', other: 'new messages' })} – ${g}`,
    digestButton: (g) => `Open ${g}`,
    reminderDue: (time) => `Reminder for ${time}`,
    reminderLine: (title, time) => `Reminder: ${title}, ${time}`,
    deadlineEvent: (title) => `Deadline: ${title}`,
    ticketNew: (n, client) => `New ticket #${n} · ${client}`,
    ticketUnassigned: (n) => `New ticket #${n} without client`,
    ticketStatus: (n, status) => `Ticket #${n}: status “${STATUS[status] ?? status}”`,
    ticketAssigned: (n) => `You were assigned #${n}`,
    ticketUpdated: (n) => `Ticket #${n}: details updated`,
    ticketTasks: (n, c) =>
      `Ticket #${n}: ${c} ${plural('en', c, { one: 'task', other: 'tasks' })} created`,
    ticketTopic: (n) => `Ticket #${n}`,
    openTicket: 'Open ticket',
    meetingScheduled: (when) => `New meeting: ${when}`,
    meetingRescheduled: (when) => `Meeting moved to ${when}`,
    meetingSummaryReady: 'The summary from AI is ready',
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
    timeMissing: 'Record your time',
    timeMissingLine: (title) => `${title}: record your time`,
    openTask: 'Open task',
    digestUpdates: (n, topic) =>
      `${topic}: ${n} ${plural('en', n, { one: 'update', other: 'updates' })}`,
    digestMany: (n, topics, more) =>
      `${n} ${plural('en', n, { one: 'update', other: 'updates' })}: ${topics.join(', ')}${more > 0 ? ` and ${more} more` : ''}`,
    digestMore: (n) => `And ${n} more in Help.`,
    dueChanged: (date) => `Due date changed to ${date}`,
    dueRemoved: 'Due date removed',
    overdue: (date) => `Overdue, was due ${date}`,
    ticketResolved: (n) => `Ticket #${n} resolved`,
    mentionedInDescription: (name) => `${name} mentioned you in the description`,
    openKnowledge: 'Open item',
    openProject: 'Open project',
    actionDone: 'Done',
    actionLogTime: 'Log time',
    actionReply: 'Reply',
    replyPlaceholder: 'Write a reply…',
  },
  teams: {
    recordingNotice: 'This call will be recorded and transcribed.',
    recordingMayNotice: 'This call may be recorded and transcribed.',
    addToCalendar: 'Add to your calendar:',
    join: 'Join in Teams:',
  },
};
