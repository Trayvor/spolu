import type { TicketStatus } from '@spolu/shared';
import { plural } from './plural.js';
import type { ServerTexts } from './types.js';

const STATUS: Record<TicketStatus, string> = {
  new: 'Nuovo',
  in_progress: 'In lavorazione',
  resolved: 'Risolto',
};

export const it: ServerTexts = {
  intl: 'it-IT',
  email: {
    footer: [
      'Help by eGrant',
      "Questa email è stata inviata automaticamente dall'app Help by eGrant.",
    ],
  },
  bulkEmail: {
    reason: 'Riceve questa email perché ha un account in Help by eGrant.',
    unsubscribe: 'Annulla iscrizione',
  },
  auth: {
    loginCode: {
      subject: (code) => `Il Suo codice di accesso a Help by eGrant: ${code}`,
      heading: 'Il Suo codice di accesso',
      body: 'È valido per 5 minuti. Se non lo ha richiesto, ignori questa email.',
    },
    adminAdded: {
      subject: 'Ora ha accesso a Help by eGrant',
      greeting: (name) => `Gentile ${name},`,
      body: ({ addedBy, email }) =>
        `${addedBy} ha aggiunto il Suo account come amministratore di Help by eGrant. Acceda con la Sua email ${email}.`,
      button: 'Accedi',
    },
    memberInvited: {
      subject: (group) => `Invito a Help by eGrant – ${group}`,
      body: ({ invitedBy, groupName, email }) =>
        `${invitedBy} Le ha inviato un invito per il gruppo ${groupName} in Help by eGrant. Acceda con la Sua email ${email}.`,
      button: 'Accedi',
    },
    memberAdded: {
      subject: (group) => `Ora fa parte di ${group}`,
      body: ({ addedBy, groupName }) =>
        `${addedBy} ha aggiunto il Suo account al gruppo ${groupName} in Help by eGrant.`,
      button: 'Apri il gruppo',
    },
    emailChangeCode: {
      subject: (code) => `Il Suo codice per cambiare email in Help by eGrant: ${code}`,
      heading: 'Il Suo codice per cambiare email',
      body: (email) =>
        `Lo inserisca nell'app Help per cambiare la Sua email in ${email}. È valido per 5 minuti. Se non lo ha richiesto, ignori questa email.`,
    },
    emailChanged: {
      subject: 'La Sua email in Help by eGrant è stata cambiata',
      body: (newEmail) =>
        `L'email del Suo account Help by eGrant è stata cambiata in ${newEmail}. D'ora in poi acceda con il nuovo indirizzo.`,
      warning: 'Se non ha effettuato Lei questa modifica, contatti subito il Suo amministratore.',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Ticket #${n} creato: ${title}`,
      untitled: 'la Sua richiesta',
      received: (n, title) => `Abbiamo ricevuto il Suo ticket di supporto #${n}: ${title}.`,
      followUp:
        "Nell'app Help può seguirlo e scrivere a eGrant. Acceda con questo indirizzo email; Le invieremo un codice.",
      followUpLink:
        "Nell'app Help può seguirlo e scrivere a eGrant. Il pulsante La fa accedere direttamente, senza codice, ed è valido 7 giorni. Non inoltri questa email.",
      button: 'Apri il ticket',
    },
  },
  groups: {
    managerAdded: {
      subject: (g) => `Ora sei un manager del cliente ${g}`,
      body: (g) =>
        `eGrant ti ha nominato manager del cliente ${g} in Help by eGrant. Riceverai le notifiche di tutti i suoi messaggi finché non lo cambi con la campanella.`,
      button: 'Apri il cliente',
    },
  },
  notifications: {
    sentFile: (name) => `${name} ha inviato un file`,
    moved: (label) => `Spostata in ${label}`,
    movedGeneric: 'Attività spostata',
    assigned: (name) => `${name} Le ha assegnato questa attività`,
    deadline: (d) =>
      d === 1
        ? 'Scadenza domani'
        : `Scadenza tra ${d} ${plural('it', d, { one: 'giorno', many: 'giorni', other: 'giorni' })}`,
    urgent: 'Urgente: ancora aperta',
    bucket: (l) => {
      switch (l.kind) {
        case 'todo':
          return 'Da fare';
        case 'egrant_review':
          return 'Revisione eGrant';
        case 'client_review':
          return `Revisione ${l.name ?? ''}`.trim();
        case 'done':
          return 'Completate';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('it', n, { one: 'nuovo messaggio', many: 'nuovi messaggi', other: 'nuovi messaggi' })} in ${g}`,
    digestButton: (g) => `Apri ${g}`,
    reminderDue: (time) => `Promemoria per ${time}`,
    reminderLine: (title, time) => `Promemoria: ${title}, ${time}`,
    deadlineEvent: (title) => `Scadenza: ${title}`,
    ticketNew: (n, client) => `Nuovo ticket #${n} · ${client}`,
    ticketUnassigned: (n) => `Nuovo ticket #${n} senza cliente`,
    ticketStatus: (n, status) => `#${n} ora è ${STATUS[status] ?? status}`,
    ticketAssigned: (n) => `Sei assegnatario del ticket #${n}`,
    ticketUpdated: (n) => `#${n} è stato modificato`,
    ticketTasks: (n, c) =>
      `#${n} trasformato in ${c} ${plural('it', c, { one: 'attività', many: 'attività', other: 'attività' })}`,
    ticketTopic: (n) => `Ticket #${n}`,
    openTicket: 'Apri il ticket',
    meetingScheduled: (when) => `Nuova riunione: ${when}`,
    meetingRescheduled: (when) => `Riunione spostata a ${when}`,
    meetingSummaryReady: 'Il riepilogo AI è pronto',
    meetingSummaryFailed: 'Elaborazione AI non riuscita',
    openMeeting: 'Apri la riunione',
    contractEnds: (date) => `Il contratto scade il ${date}`,
    contractLine: (title, client, date) => `Contratto ${title} · ${client}: scade il ${date}`,
    openContract: 'Apri il contratto',
    expenseDue: (date) => `Spesa in scadenza il ${date}`,
    expenseLine: (title, date) => `Spesa ${title}: scade il ${date}`,
    salaryTitle: (name) => `Stipendio: ${name}`,
    openExpense: 'Apri la spesa',
    financeTopic: 'Finanze',
    timeMissing: 'Indica quanto tempo hai impiegato',
    timeMissingLine: (title) => `${title}: indica il tuo tempo`,
    openTask: 'Apri attività',
  },
};
