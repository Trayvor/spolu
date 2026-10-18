import type { TicketStatus } from '@spolu/shared';
import { plural } from './plural.js';
import type { ServerTexts } from './types.js';

const STATUS: Record<TicketStatus, string> = {
  new: 'Nov',
  in_progress: 'V obdelavi',
  resolved: 'Rešen',
};

export const sl: ServerTexts = {
  intl: 'sl-SI',
  email: {
    footer: ['Help by eGrant', 'To e-sporočilo je samodejno poslala aplikacija Help by eGrant.'],
  },
  bulkEmail: {
    reason: 'To e-sporočilo prejemate, ker imate račun v aplikaciji Help by eGrant.',
    unsubscribe: 'Odjava od prejemanja',
  },
  auth: {
    loginCode: {
      subject: (code) => `Vaša koda za prijavo v aplikacijo Help: ${code}`,
      heading: 'Vaša koda za prijavo',
      body: 'Velja 5 minut. Če je niste zahtevali, to e-sporočilo prezrite.',
    },
    adminAdded: {
      subject: 'Dodani ste bili v aplikacijo Help',
      greeting: (name) => `Pozdravljeni, ${name},`,
      body: ({ addedBy, email }) =>
        `Oseba ${addedBy} vas je dodala kot skrbnika v aplikaciji Help by eGrant. Prijavite se s svojim e-poštnim naslovom ${email}.`,
      button: 'Prijava',
    },
    memberInvited: {
      subject: (group) => `Povabilo v aplikacijo Help – ${group}`,
      body: ({ invitedBy, groupName, email }) =>
        `Oseba ${invitedBy} vas je povabila v skupino ${groupName} v aplikaciji Help by eGrant. Prijavite se s svojim e-poštnim naslovom ${email}.`,
      button: 'Prijava',
    },
    memberAdded: {
      subject: (group) => `Dodani ste bili v skupino ${group}`,
      body: ({ addedBy, groupName }) =>
        `Oseba ${addedBy} vas je dodala v skupino ${groupName} v aplikaciji Help by eGrant.`,
      button: 'Odpri skupino',
    },
    emailChangeCode: {
      subject: (code) => `Koda za spremembo e-poštnega naslova v aplikaciji Help: ${code}`,
      heading: 'Koda za spremembo e-poštnega naslova',
      body: (email) =>
        `Vnesite jo v aplikaciji Help in vaš e-poštni naslov se bo spremenil v ${email}. Velja 5 minut. Če je niste zahtevali, to e-sporočilo prezrite.`,
    },
    emailChanged: {
      subject: 'Vaš e-poštni naslov v aplikaciji Help je bil spremenjen',
      body: (newEmail) =>
        `E-poštni naslov vašega računa v aplikaciji Help je bil spremenjen v ${newEmail}. Odslej se prijavljajte z novim naslovom.`,
      warning: 'Če tega niste storili vi, se takoj obrnite na svojega skrbnika.',
    },
  },
  mcp: {
    tokenCreated: {
      subject: 'V aplikaciji Help je bil ustvarjen nov žeton za dostop AI',
      body: ({ name, date }) =>
        `V aplikaciji Help je bil ${date} ustvarjen nov žeton za dostop AI »${name}«. Z njim lahko pomočnik AI v vašem imenu bere in spreminja podatke.`,
      warning:
        'Če to niste bili vi, žeton takoj prekličite v Nastavitvah (Dostop za AI (MCP)) in se obrnite na svojega skrbnika.',
      button: 'Odpri Nastavitve',
    },
    connectionApproved: {
      subject: 'S Help je bil povezan AI pomočnik',
      body: ({ name, host, date }) =>
        `S Help by eGrant je bil ${date} povezan pomočnik »${name}« (vrnitev na ${host}). Zdaj lahko uporablja Help v vašem imenu z dostopom, ki ste ga izbrali.`,
      warning:
        'Če to niste bili vi, ga takoj odklopite v Nastavitvah (Dostop za AI (MCP)) in se obrnite na svojega skrbnika.',
      button: 'Odpri Nastavitve',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Zahtevek #${n} je ustvarjen: ${title}`,
      untitled: 'vaša zahteva',
      received: (n, title) => `Prejeli smo vaš zahtevek za tehnično podporo #${n}: ${title}.`,
      followUp:
        'V aplikaciji Help ga lahko spremljate in pišete eGrant. Prijavite se s tem e-poštnim naslovom; poslali vam bomo kodo.',
      followUpLink:
        'V aplikaciji Help ga lahko spremljate in pišete eGrant. Gumb vas prijavi neposredno, brez kode, in velja 7 dni. Tega e-poštnega sporočila ne posredujte naprej.',
      button: 'Odpri zahtevek',
    },
  },
  notifications: {
    sentFile: (name) => `${name}: nova datoteka`,
    moved: (label) => `Premaknjeno v ${label}`,
    movedGeneric: 'Naloga je premaknjena',
    assigned: (name) => `Oseba ${name} vam je dodelila to nalogo`,
    deadline: (d) =>
      d === 1
        ? 'Rok jutri'
        : `Rok čez ${d} ${plural('sl', d, { one: 'dan', two: 'dneva', few: 'dni', other: 'dni' })}`,
    urgent: 'Nujno: še vedno odprto',
    bucket: (l) => {
      switch (l.kind) {
        case 'todo':
          return 'Za narediti';
        case 'egrant_review':
          return 'Pregled eGrant';
        case 'client_review':
          return `Pregled ${l.name ?? ''}`.trim();
        case 'done':
          return 'Dokončano';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('sl', n, {
        one: 'novo sporočilo',
        two: 'novi sporočili',
        few: 'nova sporočila',
        other: 'novih sporočil',
      })} v skupini ${g}`,
    digestButton: (g) => `Odpri ${g}`,
    reminderDue: (time) => `Opomnik za ${time}`,
    reminderLine: (title, time) => `Opomnik: ${title}, ${time}`,
    deadlineEvent: (title) => `Rok: ${title}`,
    ticketNew: (n, client) => `Nov zahtevek #${n} · ${client}`,
    ticketUnassigned: (n) => `Nov zahtevek #${n} brez stranke`,
    ticketStatus: (n, status) => `Stanje #${n}: ${STATUS[status] ?? status}`,
    ticketAssigned: (n) => `Ste reševalec zahtevka #${n}`,
    ticketUpdated: (n) => `Zahtevek #${n} je bil spremenjen`,
    ticketTasks: (n, c) =>
      `Zahtevek #${n} je pretvorjen v ${c} ${plural('sl', c, { one: 'nalogo', two: 'nalogi', few: 'naloge', other: 'nalog' })}`,
    ticketTopic: (n) => `Zahtevek #${n}`,
    openTicket: 'Odpri zahtevek',
    meetingScheduled: (when) => `Nov sestanek: ${when}`,
    meetingRescheduled: (when) => `Sestanek prestavljen na ${when}`,
    meetingSummaryReady: 'Povzetek AI je pripravljen',
    meetingSummaryFailed: 'Obdelava z AI ni uspela',
    openMeeting: 'Odpri sestanek',
    contractEnds: (date) => `Pogodba se izteče ${date}`,
    contractLine: (title, client, date) => `Pogodba ${title} · ${client}: izteče se ${date}`,
    openContract: 'Odpri pogodbo',
    expenseDue: (date) => `Strošek zapade ${date}`,
    expenseLine: (title, date) => `Strošek ${title}: zapade ${date}`,
    salaryTitle: (name) => `Plača: ${name}`,
    openExpense: 'Odpri strošek',
    financeTopic: 'Finance',
    timeMissing: 'Vpišite, koliko časa ste porabili',
    timeMissingLine: (title) => `${title}: vpišite svoj čas`,
    openTask: 'Odpri nalogo',
  },
  teams: {
    recordingNotice: 'Ta klic bo posnet in prepisan.',
    recordingMayNotice: 'Ta klic je lahko posnet in prepisan.',
    addToCalendar: 'Dodaj v koledar:',
    join: 'Pridruži se v Teams:',
  },
};
