import type { TicketStatus } from '@spolu/shared';
import { plural } from './plural.js';
import type { ServerTexts } from './types.js';

const STATUS: Record<TicketStatus, string> = {
  new: 'Nový',
  in_progress: 'Řeší se',
  resolved: 'Vyřešený',
};

export const cs: ServerTexts = {
  intl: 'cs-CZ',
  email: {
    footer: ['Help by eGrant', 'Tento e-mail byl odeslán automaticky z aplikace Help by eGrant.'],
  },
  bulkEmail: {
    reason: 'Tento e-mail dostáváte, protože máte účet v aplikaci Help by eGrant.',
    unsubscribe: 'Odhlásit odběr',
  },
  auth: {
    loginCode: {
      subject: (code) => `Váš přihlašovací kód do aplikace Help: ${code}`,
      heading: 'Váš přihlašovací kód',
      body: 'Platí 5 minut. Pokud jste o něj nežádali, tento e-mail ignorujte.',
    },
    adminAdded: {
      subject: 'Byli jste přidáni do aplikace Help',
      greeting: (name) => `Dobrý den, ${name},`,
      body: ({ addedBy, email }) =>
        `${addedBy} vás přidal(a) jako administrátora v aplikaci Help by eGrant. Přihlaste se svým e-mailem ${email}.`,
      button: 'Přihlásit se',
    },
    memberInvited: {
      subject: (group) => `Pozvánka do aplikace Help – ${group}`,
      body: ({ invitedBy, groupName, email }) =>
        `${invitedBy} vás pozval(a) do skupiny ${groupName} v aplikaci Help by eGrant. Přihlaste se svým e-mailem ${email}.`,
      button: 'Přihlásit se',
    },
    memberAdded: {
      subject: (group) => `Byli jste přidáni do skupiny ${group}`,
      body: ({ addedBy, groupName }) =>
        `${addedBy} vás přidal(a) do skupiny ${groupName} v aplikaci Help by eGrant.`,
      button: 'Otevřít skupinu',
    },
    emailChangeCode: {
      subject: (code) => `Kód pro změnu e-mailu v aplikaci Help: ${code}`,
      heading: 'Kód pro změnu e-mailu',
      body: (email) =>
        `Zadejte ho v aplikaci Help a váš e-mail se změní na ${email}. Platí 5 minut. Pokud jste o něj nežádali, tento e-mail ignorujte.`,
    },
    emailChanged: {
      subject: 'Váš e-mail v aplikaci Help byl změněn',
      body: (newEmail) =>
        `E-mail vašeho účtu v aplikaci Help byl změněn na ${newEmail}. Od teď se přihlašujte novou adresou.`,
      warning: 'Pokud jste to nebyli vy, okamžitě kontaktujte svého administrátora.',
    },
  },
  mcp: {
    tokenCreated: {
      subject: 'Nový přístupový token pro AI v aplikaci Help',
      body: ({ name, date }) =>
        `V aplikaci Help byl ${date} vytvořen nový přístupový token pro AI „${name}“. S ním může AI asistent číst a měnit data vaším jménem.`,
      warning:
        'Pokud jste to nebyli vy, token ihned zrušte v Nastavení (Přístup pro AI (MCP)) a kontaktujte svého administrátora.',
      button: 'Otevřít Nastavení',
    },
    connectionApproved: {
      subject: 'K aplikaci Help byl připojen AI asistent',
      body: ({ name, host, date }) =>
        `K aplikaci Help byl ${date} připojen asistent „${name}“ (návrat na ${host}). Od teď může používat Help vaším jménem s přístupem, který jste zvolili.`,
      warning:
        'Pokud jste to nebyli vy, asistenta ihned odpojte v Nastavení (Přístup pro AI (MCP)) a kontaktujte svého administrátora.',
      button: 'Otevřít Nastavení',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Tiket #${n} byl vytvořen: ${title}`,
      untitled: 'váš požadavek',
      received: (n, title) => `Přijali jsme váš tiket technické podpory #${n}: ${title}.`,
      followUp:
        'V aplikaci Help ho můžete sledovat a psát eGrantu. Přihlaste se touto e-mailovou adresou, pošleme vám kód.',
      followUpLink:
        'V aplikaci Help ho můžete sledovat a psát eGrantu. Tlačítko vás přihlásí přímo, bez kódu, a platí 7 dní. Tento e-mail nikomu nepřeposílejte.',
      button: 'Otevřít tiket',
    },
  },
  notifications: {
    sentFile: (name) => `${name} poslal(a) soubor`,
    moved: (label) => `Přesunuto do: ${label}`,
    movedGeneric: 'Úkol přesunut',
    assigned: (name) => `${name} vám přidělil(a) úkol`,
    deadline: (d) =>
      d === 1
        ? 'Termín zítra'
        : `Termín za ${d} ${plural('cs', d, { one: 'den', few: 'dny', many: 'dne', other: 'dní' })}`,
    urgent: 'Naléhavé: stále otevřené',
    bucket: (l) => {
      switch (l.kind) {
        case 'todo':
          return 'K vyřízení';
        case 'egrant_review':
          return 'Kontrola eGrant';
        case 'client_review':
          return `Kontrola ${l.name ?? ''}`.trim();
        case 'done':
          return 'Dokončené';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('cs', n, {
        one: 'nová zpráva',
        few: 'nové zprávy',
        many: 'nové zprávy',
        other: 'nových zpráv',
      })} ve skupině ${g}`,
    digestButton: (g) => `Otevřít ${g}`,
    reminderDue: (time) => `Připomínka na ${time}`,
    reminderLine: (title, time) => `Připomínka: ${title}, ${time}`,
    deadlineEvent: (title) => `Termín: ${title}`,
    ticketNew: (n, client) => `Nový tiket #${n} · ${client}`,
    ticketUnassigned: (n) => `Nový tiket #${n} bez klienta`,
    ticketStatus: (n, status) => `#${n} je nyní ve stavu ${STATUS[status] ?? status}`,
    ticketAssigned: (n) => `Jste řešitelem tiketu #${n}`,
    ticketUpdated: (n) => `#${n} byl změněn`,
    ticketTasks: (n, c) =>
      `#${n} převeden na ${c} ${plural('cs', c, { one: 'úkol', few: 'úkoly', many: 'úkolu', other: 'úkolů' })}`,
    ticketTopic: (n) => `Tiket #${n}`,
    openTicket: 'Otevřít tiket',
    meetingScheduled: (when) => `Nová schůzka: ${when}`,
    meetingRescheduled: (when) => `Schůzka přesunuta na ${when}`,
    meetingSummaryReady: 'AI shrnutí je hotové',
    meetingSummaryFailed: 'Zpracování s AI selhalo',
    openMeeting: 'Otevřít schůzku',
    contractEnds: (date) => `Smlouva končí ${date}`,
    contractLine: (title, client, date) => `Smlouva ${title} · ${client}: končí ${date}`,
    openContract: 'Otevřít smlouvu',
    expenseDue: (date) => `Výdaj splatný ${date}`,
    expenseLine: (title, date) => `Výdaj ${title}: splatný ${date}`,
    salaryTitle: (name) => `Mzda: ${name}`,
    openExpense: 'Otevřít výdaj',
    financeTopic: 'Finance',
    timeMissing: 'Vyplňte, kolik času jste strávili',
    timeMissingLine: (title) => `${title}: vyplňte svůj čas`,
    openTask: 'Otevřít úkol',
  },
  teams: {
    recordingNotice: 'Tento hovor bude nahráván a přepisován.',
    recordingMayNotice: 'Tento hovor může být nahráván a přepisován.',
    addToCalendar: 'Přidat do kalendáře:',
    join: 'Připojit se v Teams:',
  },
};
