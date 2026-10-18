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
  mcp: {
    tokenCreated: {
      subject: "È stato creato un nuovo token di accesso per l'IA in Help",
      body: ({ name, date }) =>
        `Il ${date} è stato creato in Help by eGrant un nuovo token di accesso per l'IA «${name}». Con esso un assistente IA può leggere e modificare i dati a Suo nome.`,
      warning:
        "Se non è stato Lei, lo revochi subito in Impostazioni → Accesso per l'IA (MCP) e contatti il Suo amministratore.",
      button: 'Apri Impostazioni',
    },
    connectionApproved: {
      subject: 'Un assistente IA è stato collegato a Help',
      body: ({ name, host, date }) =>
        `Il ${date} l'assistente «${name}» (ritorno su ${host}) è stato collegato a Help by eGrant. Ora può usare Help a Suo nome con l'accesso che ha scelto.`,
      warning:
        "Se non è stato Lei, lo scolleghi subito in Impostazioni → Accesso per l'IA (MCP) e contatti il Suo amministratore.",
      button: 'Apri Impostazioni',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Ticket #${n} creato: ${title}`,
      untitled: 'la Sua richiesta',
      received: (n, title) => `Abbiamo ricevuto il Suo ticket #${n}: ${title}.`,
      followUp:
        "Nell'app Help può seguirlo e scrivere a eGrant. Acceda con questo indirizzo email; Le invieremo un codice.",
      followUpLink:
        "Nell'app Help può seguirlo e scrivere a eGrant. Il pulsante La fa accedere direttamente, senza codice, ed è valido 7 giorni. Non inoltri questa email.",
      button: 'Apri il ticket',
    },
  },
  notifications: {
    sentFile: (name) => `${name} ha inviato un file`,
    moved: (label) => `Spostata nella colonna “${label}”`,
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
          return `Revisione ${l.name ?? 'cliente'}`;
        case 'done':
          return 'Completate';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('it', n, { one: 'nuovo messaggio', many: 'nuovi messaggi', other: 'nuovi messaggi' })} – ${g}`,
    digestButton: () => 'Apri il gruppo',
    reminderDue: (time) => `Promemoria per ${time}`,
    reminderLine: (title, time) => `Promemoria: ${title}, ${time}`,
    deadlineEvent: (title) => `Scadenza: ${title}`,
    ticketNew: (n, client) => `Nuovo ticket #${n} · ${client}`,
    ticketUnassigned: (n) => `Nuovo ticket #${n} senza cliente`,
    ticketStatus: (n, status) => `Ticket #${n}: stato “${STATUS[status] ?? status}”`,
    ticketAssigned: (n) => `Le è stato assegnato il ticket #${n}`,
    ticketUpdated: (n) => `Ticket #${n}: dati aggiornati`,
    ticketTasks: (n, c) =>
      `Ticket #${n}: ${c} ${plural('it', c, { one: 'attività creata', many: 'attività create', other: 'attività create' })}`,
    ticketTopic: (n) => `Ticket #${n}`,
    openTicket: 'Apri il ticket',
    meetingScheduled: (when) => `Nuova riunione: ${when}`,
    meetingRescheduled: (when) => `Riunione spostata a ${when}`,
    meetingSummaryReady: "Il riepilogo dell'IA è pronto",
    meetingSummaryFailed: "Elaborazione con l'IA non riuscita",
    openMeeting: 'Apri la riunione',
    contractEnds: (date) => `Il contratto scade il ${date}`,
    contractLine: (title, client, date) => `Contratto ${title} · ${client}: scade il ${date}`,
    openContract: 'Apri il contratto',
    expenseDue: (date) => `Spesa in scadenza il ${date}`,
    expenseLine: (title, date) => `Spesa ${title}: scade il ${date}`,
    salaryTitle: (name) => `Stipendio: ${name}`,
    openExpense: 'Apri la spesa',
    financeTopic: 'Finanze',
    timeMissing: 'Tempo impiegato da registrare',
    timeMissingLine: (title) => `${title}: tempo impiegato da registrare`,
    openTask: 'Apri attività',
  },
  teams: {
    recordingNotice: 'Questa chiamata sarà registrata e trascritta.',
    recordingMayNotice: 'Questa chiamata potrebbe essere registrata e trascritta.',
    addToCalendar: 'Aggiungi al calendario:',
    join: 'Partecipa in Teams:',
  },
};
