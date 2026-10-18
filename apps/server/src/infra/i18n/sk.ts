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
    passkeyCode: {
      subject: (code) => `Kód na pridanie kľúča (passkey) v aplikácii Help: ${code}`,
      heading: 'Kód na pridanie kľúča (passkey)',
      body: 'Zadajte ho v aplikácii Help a k vášmu účtu sa pridá kľúč (passkey). Platí 5 minút. Ak ste oň nežiadali, tento e-mail ignorujte.',
    },
    passkeyAdded: {
      subject: 'K vášmu účtu v aplikácii Help bol pridaný nový kľúč (passkey)',
      body: ({ name, date }) =>
        `K vášmu účtu v aplikácii Help bol ${date} pridaný nový kľúč (passkey) „${name}“. Môžete sa ním prihlásiť bez kódu z e-mailu.`,
      warning:
        'Ak ste to neboli vy, kľúč ihneď vymažte v Nastaveniach → Kľúče (passkeys) a kontaktujte svojho administrátora.',
      button: 'Otvoriť Nastavenia',
    },
  },
  mcp: {
    tokenCreated: {
      subject: 'Nový prístupový token pre AI v aplikácii Help',
      body: ({ name, date }) =>
        `V aplikácii Help bol ${date} vytvorený nový prístupový token pre AI „${name}“. S ním môže AI asistent čítať a meniť dáta vo vašom mene.`,
      warning:
        'Ak ste to neboli vy, token ihneď zrušte v Nastaveniach → Prístup pre AI (MCP) a kontaktujte svojho administrátora.',
      button: 'Otvoriť Nastavenia',
    },
    connectionApproved: {
      subject: 'K aplikácii Help bol pripojený AI asistent',
      body: ({ name, host, date }) =>
        `K aplikácii Help bol ${date} pripojený asistent „${name}“ (návrat na ${host}). Odteraz môže používať Help vo vašom mene s prístupom, ktorý ste zvolili.`,
      warning:
        'Ak ste to neboli vy, asistenta ihneď odpojte v Nastaveniach → Prístup pre AI (MCP) a kontaktujte svojho administrátora.',
      button: 'Otvoriť Nastavenia',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Tiket #${n} bol vytvorený: ${title}`,
      untitled: 'vaša požiadavka',
      received: (n, title) => `Prijali sme váš tiket #${n}: ${title}.`,
      followUp:
        'V aplikácii Help ho môžete sledovať a písať eGrantu. Prihláste sa touto e-mailovou adresou, pošleme vám kód.',
      followUpLink:
        'V aplikácii Help ho môžete sledovať a písať eGrantu. Tlačidlo vás prihlási priamo, bez kódu, a platí 7 dní. Tento e-mail nikomu nepreposielajte.',
      button: 'Otvoriť tiket',
    },
  },
  notifications: {
    sentFile: (name) => `${name} poslal(a) súbor`,
    moved: (label) => `Presunuté do stĺpca „${label}“`,
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
          return 'Kontroluje eGrant';
        case 'client_review':
          return `Kontroluje ${l.name ?? 'klient'}`;
        case 'done':
          return 'Hotové';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('sk', n, { one: 'nová správa', few: 'nové správy', other: 'nových správ' })} – ${g}`,
    digestButton: (g) => `Otvoriť ${g}`,
    reminderDue: (time) => `Pripomienka na ${time}`,
    reminderLine: (title, time) => `Pripomienka: ${title}, ${time}`,
    deadlineEvent: (title) => `Termín: ${title}`,
    ticketNew: (n, client) => `Nový tiket #${n} · ${client}`,
    ticketUnassigned: (n) => `Nový tiket #${n} bez klienta`,
    ticketStatus: (n, status) => `Tiket #${n}: stav „${STATUS[status] ?? status}“`,
    ticketAssigned: (n) => `Ste riešiteľom tiketu #${n}`,
    ticketUpdated: (n) => `Tiket #${n}: upravené údaje`,
    ticketTasks: (n, c) =>
      `Tiket #${n}: ${plural('sk', c, { one: 'vytvorená', few: 'vytvorené', other: 'vytvorených' })} ${c} ${plural('sk', c, { one: 'úloha', few: 'úlohy', other: 'úloh' })}`,
    ticketTopic: (n) => `Tiket #${n}`,
    openTicket: 'Otvoriť tiket',
    meetingScheduled: (when) => `Nové stretnutie: ${when}`,
    meetingRescheduled: (when) => `Stretnutie presunuté na ${when}`,
    meetingSummaryReady: 'Zhrnutie od AI je hotové',
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
    timeMissing: 'Zapíšte strávený čas',
    timeMissingLine: (title) => `${title}: zapíšte strávený čas`,
    openTask: 'Otvoriť úlohu',
    digestUpdates: (n, topic) =>
      `${topic}: ${n} ${plural('sk', n, { one: 'zmena', few: 'zmeny', other: 'zmien' })}`,
    digestMany: (n, topics, more) =>
      `${n} ${plural('sk', n, { one: 'zmena', few: 'zmeny', other: 'zmien' })}: ${topics.join(', ')}${more > 0 ? ` a ďalšie ${more}` : ''}`,
    digestMore: (n) => `A ďalšie (${n}) v aplikácii Help.`,
    dueChanged: (date) => `Termín zmenený na ${date}`,
    dueRemoved: 'Termín zrušený',
    overdue: (date) => `Po termíne, termín bol ${date}`,
    ticketResolved: (n) => `Tiket #${n} je vyriešený`,
    mentionedInDescription: (name) => `${name} vás spomenul(a) v popise`,
    openKnowledge: 'Otvoriť položku',
    openProject: 'Otvoriť projekt',
  },
  teams: {
    recordingNotice: 'Tento hovor bude nahrávaný a prepisovaný.',
    recordingMayNotice: 'Tento hovor môže byť nahrávaný a prepisovaný.',
    addToCalendar: 'Pridať do kalendára:',
    join: 'Pripojiť sa v Teams:',
  },
};
