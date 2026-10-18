import type { TicketStatus } from '@spolu/shared';
import { plural } from './plural.js';
import type { ServerTexts } from './types.js';

const STATUS: Record<TicketStatus, string> = {
  new: 'Nový',
  in_progress: 'V riešení',
  resolved: 'Vyriešený',
};

export const sk: ServerTexts = {
  intl: 'sk-SK',
  email: {
    footer: ['Help by eGrant', 'Tento e-mail bol odoslaný automaticky z aplikácie Help by eGrant.'],
  },
  bulkEmail: {
    reason: 'Tento e-mail dostávate, pretože máte účet v aplikácii Help by eGrant.',
    unsubscribe: 'Odhlásiť sa z odberu',
  },
  auth: {
    loginCode: {
      subject: (code) => `Váš prihlasovací kód do aplikácie Help: ${code}`,
      heading: 'Váš prihlasovací kód',
      body: 'Platí 5 minút. Ak ste oň nežiadali, tento e-mail ignorujte.',
    },
    adminAdded: {
      subject: 'Pridali vás do aplikácie Help',
      greeting: (name) => `Dobrý deň, ${name},`,
      body: ({ addedBy, email }) =>
        `${addedBy} vás pridal(a) ako administrátora v aplikácii Help by eGrant. Prihláste sa svojím e-mailom ${email}.`,
      button: 'Prihlásiť sa',
    },
    memberInvited: {
      subject: (group) => `Pozvánka do aplikácie Help – ${group}`,
      body: ({ invitedBy, groupName, email }) =>
        `${invitedBy} vás pozval(a) do skupiny ${groupName} v aplikácii Help by eGrant. Prihláste sa svojím e-mailom ${email}.`,
      button: 'Prihlásiť sa',
    },
    memberAdded: {
      subject: (group) => `Pridali vás do skupiny ${group}`,
      body: ({ addedBy, groupName }) =>
        `${addedBy} vás pridal(a) do skupiny ${groupName} v aplikácii Help by eGrant.`,
      button: 'Otvoriť skupinu',
    },
    emailChangeCode: {
      subject: (code) => `Kód na zmenu e-mailu v aplikácii Help: ${code}`,
      heading: 'Kód na zmenu e-mailu',
      body: (email) =>
        `Zadajte ho v aplikácii Help a váš e-mail sa zmení na ${email}. Platí 5 minút. Ak ste oň nežiadali, tento e-mail ignorujte.`,
    },
    emailChanged: {
      subject: 'Váš e-mail v aplikácii Help bol zmenený',
      body: (newEmail) =>
        `E-mail vášho účtu v aplikácii Help bol zmenený na ${newEmail}. Odteraz sa prihlasujte novou adresou.`,
      warning: 'Ak ste to neboli vy, ihneď kontaktujte svojho administrátora.',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Tiket #${n} bol vytvorený: ${title}`,
      untitled: 'vaša požiadavka',
      received: (n, title) => `Prijali sme váš tiket technickej podpory #${n}: ${title}.`,
      followUp:
        'V aplikácii Help ho môžete sledovať a písať eGrantu. Prihláste sa touto e-mailovou adresou, pošleme vám kód.',
      followUpLink:
        'V aplikácii Help ho môžete sledovať a písať eGrantu. Tlačidlo vás prihlási priamo, bez kódu, a platí 7 dní. Tento e-mail nikomu nepreposielajte.',
      button: 'Otvoriť tiket',
    },
  },
  notifications: {
    sentFile: (name) => `${name} poslal(a) súbor`,
    moved: (label) => `Presunuté do ${label}`,
    movedGeneric: 'Úloha presunutá',
    assigned: (name) => `${name} vás priradil(a) k úlohe`,
    deadline: (d) =>
      d === 1 ? 'Termín zajtra' : `Termín o ${d} ${plural('sk', d, { few: 'dni', other: 'dní' })}`,
    urgent: 'Urgentné: stále otvorené',
    bucket: (l) => {
      switch (l.kind) {
        case 'todo':
          return 'Na spracovanie';
        case 'egrant_review':
          return 'Kontrola eGrant';
        case 'client_review':
          return `Kontrola ${l.name ?? ''}`.trim();
        case 'done':
          return 'Hotové';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('sk', n, { one: 'nová správa', few: 'nové správy', other: 'nových správ' })} v ${g}`,
    digestButton: (g) => `Otvoriť ${g}`,
    reminderDue: (time) => `Pripomienka na ${time}`,
    reminderLine: (title, time) => `Pripomienka: ${title}, ${time}`,
    deadlineEvent: (title) => `Termín: ${title}`,
    ticketNew: (n, client) => `Nový tiket #${n} · ${client}`,
    ticketUnassigned: (n) => `Nový tiket #${n} bez klienta`,
    ticketStatus: (n, status) => `#${n} je teraz ${STATUS[status] ?? status}`,
    ticketAssigned: (n) => `Ste riešiteľom tiketu #${n}`,
    ticketUpdated: (n) => `#${n} bol zmenený`,
    ticketTasks: (n, c) =>
      `#${n} rozdelený na ${c} ${plural('sk', c, { one: 'úlohu', few: 'úlohy', other: 'úloh' })}`,
    ticketTopic: (n) => `Tiket #${n}`,
    openTicket: 'Otvoriť tiket',
    meetingScheduled: (when) => `Nové stretnutie: ${when}`,
    meetingRescheduled: (when) => `Stretnutie presunuté na ${when}`,
    meetingSummaryReady: 'AI zhrnutie je hotové',
    meetingSummaryFailed: 'Spracovanie s AI zlyhalo',
    openMeeting: 'Otvoriť stretnutie',
    contractEnds: (date) => `Zmluva končí ${date}`,
    contractLine: (title, client, date) => `Zmluva ${title} · ${client}: končí ${date}`,
    openContract: 'Otvoriť zmluvu',
    expenseDue: (date) => `Výdavok splatný ${date}`,
    expenseLine: (title, date) => `Výdavok ${title}: splatný ${date}`,
    salaryTitle: (name) => `Mzda: ${name}`,
    openExpense: 'Otvoriť výdavok',
    financeTopic: 'Financie',
    timeMissing: 'Vyplňte, koľko času ste strávili',
    timeMissingLine: (title) => `${title}: vyplňte svoj čas`,
    openTask: 'Otvoriť úlohu',
  },
};
