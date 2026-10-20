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
        `${invitedBy} vás pozval(a) ke klientovi ${groupName} v aplikaci Help by eGrant. Přihlaste se svým e-mailem ${email}.`,
      button: 'Přihlásit se',
    },
    memberAdded: {
      subject: (group) => `Byli jste přidáni ke klientovi ${group}`,
      body: ({ addedBy, groupName }) =>
        `${addedBy} vás přidal(a) ke klientovi ${groupName} v aplikaci Help by eGrant.`,
      button: 'Otevřít klienta',
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
    passkeyCode: {
      subject: (code) => `Kód pro přidání klíče (passkey) v aplikaci Help: ${code}`,
      heading: 'Kód pro přidání klíče (passkey)',
      body: 'Zadejte ho v aplikaci Help a k vašemu účtu se přidá klíč (passkey). Platí 5 minut. Pokud jste o něj nežádali, tento e-mail ignorujte.',
    },
    passkeyAdded: {
      subject: 'K vašemu účtu v aplikaci Help byl přidán nový klíč (passkey)',
      body: ({ name, date }) =>
        `K vašemu účtu v aplikaci Help byl ${date} přidán nový klíč (passkey) „${name}“. Můžete se jím přihlásit bez kódu z e-mailu.`,
      warning:
        'Pokud jste to nebyli vy, klíč ihned smažte v Nastavení → Klíče (passkeys) a kontaktujte svého administrátora.',
      button: 'Otevřít Nastavení',
    },
  },
  mcp: {
    tokenCreated: {
      subject: 'Nový přístupový token pro AI v aplikaci Help',
      body: ({ name, date }) =>
        `V aplikaci Help byl ${date} vytvořen nový přístupový token pro AI „${name}“. S ním může AI asistent číst a měnit data vaším jménem.`,
      warning:
        'Pokud jste to nebyli vy, token ihned zrušte v Nastavení → Přístup pro AI (MCP) a kontaktujte svého administrátora.',
      button: 'Otevřít Nastavení',
    },
    connectionApproved: {
      subject: 'K aplikaci Help byl připojen AI asistent',
      body: ({ name, host, date }) =>
        `K aplikaci Help byl ${date} připojen asistent „${name}“ (návrat na ${host}). Od teď může používat Help vaším jménem s přístupem, který jste zvolili.`,
      warning:
        'Pokud jste to nebyli vy, asistenta ihned odpojte v Nastavení → Přístup pro AI (MCP) a kontaktujte svého administrátora.',
      button: 'Otevřít Nastavení',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Tiket #${n} byl vytvořen: ${title}`,
      untitled: 'váš požadavek',
      received: (n, title) => `Přijali jsme váš tiket #${n}: ${title}.`,
      followUp:
        'V aplikaci Help ho můžete sledovat a psát eGrantu. Přihlaste se touto e-mailovou adresou, pošleme vám kód.',
      followUpLink:
        'V aplikaci Help ho můžete sledovat a psát eGrantu. Tlačítko vás přihlásí přímo, bez kódu, a platí 7 dní. Tento e-mail nikomu nepřeposílejte.',
      button: 'Otevřít tiket',
    },
  },
  notifications: {
    sentFile: (name) => `${name} poslal(a) soubor`,
    moved: (label) => `Přesunuto do sloupce „${label}“`,
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
          return 'Kontroluje eGrant';
        case 'client_review':
          return `Kontroluje ${l.name ?? 'klient'}`;
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
      })} – ${g}`,
    digestButton: (g) => `Otevřít ${g}`,
    reminderDue: (time) => `Připomínka na ${time}`,
    reminderLine: (title, time) => `Připomínka: ${title}, ${time}`,
    deadlineEvent: (title) => `Termín: ${title}`,
    ticketNew: (n, client) => `Nový tiket #${n} · ${client}`,
    ticketUnassigned: (n) => `Nový tiket #${n} bez klienta`,
    ticketStatus: (n, status) => `Tiket #${n}: stav „${STATUS[status] ?? status}“`,
    ticketAssigned: (n) => `Jste řešitelem tiketu #${n}`,
    ticketUpdated: (n) => `Tiket #${n}: upravené údaje`,
    ticketTasks: (n, c) =>
      `Tiket #${n}: ${plural('cs', c, { one: 'vytvořen', few: 'vytvořeny', other: 'vytvořeno' })} ${c} ${plural('cs', c, { one: 'úkol', few: 'úkoly', many: 'úkolu', other: 'úkolů' })}`,
    ticketTopic: (n) => `Tiket #${n}`,
    openTicket: 'Otevřít tiket',
    meetingScheduled: (when) => `Nová schůzka: ${when}`,
    meetingRescheduled: (when) => `Schůzka přesunuta na ${when}`,
    meetingSummaryReady: 'Shrnutí od AI je hotové',
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
    timeMissing: 'Zapište strávený čas',
    timeMissingLine: (title) => `${title}: zapište strávený čas`,
    openTask: 'Otevřít úkol',
    digestUpdates: (n, topic) =>
      `${topic}: ${n} ${plural('cs', n, { one: 'změna', few: 'změny', many: 'změny', other: 'změn' })}`,
    digestMany: (n, topics, more) =>
      `${n} ${plural('cs', n, { one: 'změna', few: 'změny', many: 'změny', other: 'změn' })}: ${topics.join(', ')}${more > 0 ? ` a další ${more}` : ''}`,
    digestMore: (n) => `A dalších ${n} v aplikaci Help.`,
    dueChanged: (date) => `Termín změněn na ${date}`,
    dueRemoved: 'Termín zrušen',
    overdue: (date) => `Po termínu, termín byl ${date}`,
    ticketResolved: (n) => `Tiket #${n} je vyřešen`,
    ticketRated: (n) => `Tiket #${n}: negativní hodnocení`,
    mentionedInDescription: (name) => `${name} vás zmínil(a) v popisu`,
    openKnowledge: 'Otevřít položku',
    openProject: 'Otevřít projekt',
    actionDone: 'Hotovo',
    actionLogTime: 'Zapsat čas',
    actionReply: 'Odpovědět',
    replyPlaceholder: 'Napište odpověď…',
  },
  teams: {
    recordingNotice: 'Tento hovor bude nahráván a přepisován.',
    recordingMayNotice: 'Tento hovor může být nahráván a přepisován.',
    addToCalendar: 'Přidat do kalendáře:',
    join: 'Připojit se v Teams:',
  },
  calendarFeed: {
    name: (userName) => `Help – ${userName}`,
    eventSummary: (project, event) => `${project} · ${event}`,
    callSummary: (title) => `Hovor: ${title}`,
    withGroup: (group, summary) => `${group}: ${summary}`,
    createdEmail: {
      subject: 'Vytvořili jste odkaz na odběr kalendáře',
      lines: [
        'Pro váš účet v Help byl vytvořen odkaz na odběr kalendáře.',
        'Pokud jste to nebyli vy, otevřete Nastavení a odběr zrušte.',
      ],
      button: 'Otevřít nastavení',
    },
  },
  weeklySummary: {
    subject: (group, range) => `Týdenní přehled: ${group}, ${range}`,
    heading: 'Týdenní přehled práce',
    done: 'Co jsme udělali',
    waiting: 'Co od vás potřebujeme',
    upcoming: 'Co nás čeká',
    button: 'Otevřít v Help',
    factsIntro: (range) => `Dobrý den, posíláme přehled práce za období ${range}.`,
    factsClosing: 'Máte-li otázky, odpovězte v chatu klienta v Help.',
    footer: (group, url) =>
      `Tento přehled dostáváte jako manažer klienta ${group}. Odhlásit se: ${url}`,
    testPrefix: '[Test]',
    reminder: {
      subject: (n) => `Týdenní přehledy ke kontrole: ${n}`,
      body: (groups, more) =>
        `Připravili jsme koncepty týdenních přehledů pro vaše klienty: ${groups.join(', ')}${more > 0 ? ` a ${more} ${plural('cs', more, { one: 'další', few: 'další', other: 'dalších' })}` : ''}. Zkontrolujte je a odešlete.`,
      button: 'Zkontrolovat',
    },
  },
};
