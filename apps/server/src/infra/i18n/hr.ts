import type { TicketStatus } from '@spolu/shared';
import { plural } from './plural.js';
import type { ServerTexts } from './types.js';

const STATUS: Record<TicketStatus, string> = {
  new: 'Novi',
  in_progress: 'U obradi',
  resolved: 'Riješen',
};

export const hr: ServerTexts = {
  intl: 'hr-HR',
  email: {
    footer: ['Help by eGrant', 'Ova je e-poruka automatski poslana iz aplikacije Help by eGrant.'],
  },
  bulkEmail: {
    reason: 'Ovu e-poruku primate jer imate račun u aplikaciji Help by eGrant.',
    unsubscribe: 'Odjava od primanja',
  },
  auth: {
    loginCode: {
      subject: (code) => `Vaš kôd za prijavu u aplikaciju Help: ${code}`,
      heading: 'Vaš kôd za prijavu',
      body: 'Vrijedi 5 minuta. Ako ga niste zatražili, zanemarite ovu e-poruku.',
    },
    adminAdded: {
      subject: 'Dodani ste u aplikaciju Help',
      greeting: (name) => `Poštovani/a ${name},`,
      body: ({ addedBy, email }) =>
        `${addedBy} dodao/la Vas je kao administratora u aplikaciji Help by eGrant. Prijavite se svojom adresom e-pošte ${email}.`,
      button: 'Prijavi se',
    },
    memberInvited: {
      subject: (group) => `Pozivnica u aplikaciju Help – ${group}`,
      body: ({ invitedBy, groupName, email }) =>
        `${invitedBy} pozvao/la Vas je u grupu ${groupName} u aplikaciji Help by eGrant. Prijavite se svojom adresom e-pošte ${email}.`,
      button: 'Prijavi se',
    },
    memberAdded: {
      subject: (group) => `Dodani ste u grupu ${group}`,
      body: ({ addedBy, groupName }) =>
        `${addedBy} dodao/la Vas je u grupu ${groupName} u aplikaciji Help by eGrant.`,
      button: 'Otvori grupu',
    },
    emailChangeCode: {
      subject: (code) => `Kôd za promjenu e-pošte u aplikaciji Help: ${code}`,
      heading: 'Kôd za promjenu e-pošte',
      body: (email) =>
        `Unesite ga u aplikaciji Help i Vaša će se adresa e-pošte promijeniti u ${email}. Vrijedi 5 minuta. Ako ga niste zatražili, zanemarite ovu e-poruku.`,
    },
    emailChanged: {
      subject: 'Vaša adresa e-pošte u aplikaciji Help je promijenjena',
      body: (newEmail) =>
        `Adresa e-pošte Vašeg računa u aplikaciji Help promijenjena je u ${newEmail}. Od sada se prijavljujte novom adresom.`,
      warning: 'Ako to niste bili Vi, odmah se obratite svojem administratoru.',
    },
  },
  mcp: {
    tokenCreated: {
      subject: 'U aplikaciji Help stvoren je novi token za pristup AI-ja',
      body: ({ name, date }) =>
        `U aplikaciji Help by eGrant ${date} stvoren je novi token za pristup AI-ja „${name}”. S njim AI asistent može čitati i mijenjati podatke u vaše ime.`,
      warning:
        'Ako to niste bili vi, odmah ga opozovite u Postavkama → Pristup za AI (MCP) i javite se svom administratoru.',
      button: 'Otvori Postavke',
    },
    connectionApproved: {
      subject: 'S Helpom je povezan AI asistent',
      body: ({ name, host, date }) =>
        `S Help by eGrant ${date} povezan je asistent „${name}” (povratak na ${host}). Sada može koristiti Help u vaše ime s pristupom koji ste odabrali.`,
      warning:
        'Ako to niste bili vi, odmah ga odspojite u Postavkama → Pristup za AI (MCP) i obratite se svom administratoru.',
      button: 'Otvori Postavke',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Tiket #${n} je stvoren: ${title}`,
      untitled: 'Vaš zahtjev',
      received: (n, title) => `Primili smo Vaš tiket #${n}: ${title}.`,
      followUp:
        'U aplikaciji Help možete ga pratiti i pisati eGrantu. Prijavite se ovom adresom e-pošte; poslat ćemo Vam kôd.',
      followUpLink:
        'U aplikaciji Help možete ga pratiti i pisati eGrantu. Gumb Vas prijavljuje izravno, bez kôda, i vrijedi 7 dana. Ne prosljeđujte ovu e-poruku.',
      button: 'Otvori tiket',
    },
  },
  notifications: {
    sentFile: (name) => `${name} poslao/la je datoteku`,
    moved: (label) => `Premješteno u stupac „${label}“`,
    movedGeneric: 'Zadatak je premješten',
    assigned: (name) => `${name} dodijelio/la Vam je zadatak`,
    deadline: (d) =>
      d === 1
        ? 'Rok je sutra'
        : `Rok za ${d} ${plural('hr', d, { one: 'dan', few: 'dana', other: 'dana' })}`,
    urgent: 'Hitno: još uvijek otvoreno',
    bucket: (l) => {
      switch (l.kind) {
        case 'todo':
          return 'Za obradu';
        case 'egrant_review':
          return 'Provjera eGranta';
        case 'client_review':
          return l.name ? `Provjera: ${l.name}` : 'Provjera klijenta';
        case 'done':
          return 'Dovršeno';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('hr', n, { one: 'nova poruka', few: 'nove poruke', other: 'novih poruka' })} – ${g}`,
    digestButton: (g) => `Otvori ${g}`,
    reminderDue: (time) => `Podsjetnik za ${time}`,
    reminderLine: (title, time) => `Podsjetnik: ${title}, ${time}`,
    deadlineEvent: (title) => `Rok: ${title}`,
    ticketNew: (n, client) => `Novi tiket #${n} · ${client}`,
    ticketUnassigned: (n) => `Novi tiket #${n} bez klijenta`,
    ticketStatus: (n, status) => `Tiket #${n}: status „${STATUS[status] ?? status}“`,
    ticketAssigned: (n) => `Vi ste rješavatelj tiketa #${n}`,
    ticketUpdated: (n) => `Tiket #${n}: ažurirani podaci`,
    ticketTasks: (n, c) =>
      `Tiket #${n}: ${plural('hr', c, { one: 'stvoren', few: 'stvorena', other: 'stvoreno' })} ${c} ${plural('hr', c, { one: 'zadatak', few: 'zadatka', other: 'zadataka' })}`,
    ticketTopic: (n) => `Tiket #${n}`,
    openTicket: 'Otvori tiket',
    meetingScheduled: (when) => `Novi sastanak: ${when}`,
    meetingRescheduled: (when) => `Sastanak premješten na ${when}`,
    meetingSummaryReady: 'Sažetak od AI-ja je spreman',
    meetingSummaryFailed: 'Obrada pomoću AI-ja nije uspjela',
    openMeeting: 'Otvori sastanak',
    contractEnds: (date) => `Ugovor istječe ${date}`,
    contractLine: (title, client, date) => `Ugovor ${title} · ${client}: istječe ${date}`,
    openContract: 'Otvori ugovor',
    expenseDue: (date) => `Trošak dospijeva ${date}`,
    expenseLine: (title, date) => `Trošak ${title}: dospijeva ${date}`,
    salaryTitle: (name) => `Plaća: ${name}`,
    openExpense: 'Otvori trošak',
    financeTopic: 'Financije',
    timeMissing: 'Upišite utrošeno vrijeme',
    timeMissingLine: (title) => `${title}: upišite utrošeno vrijeme`,
    openTask: 'Otvori zadatak',
    digestUpdates: (n, topic) =>
      `${topic}: ${n} ${plural('hr', n, { one: 'promjena', few: 'promjene', other: 'promjena' })}`,
    digestMany: (n, topics, more) =>
      `${n} ${plural('hr', n, { one: 'promjena', few: 'promjene', other: 'promjena' })}: ${topics.join(', ')}${more > 0 ? ` i još ${more}` : ''}`,
    digestMore: (n) => `I još ${n} u aplikaciji Help.`,
    dueChanged: (date) => `Rok promijenjen na ${date}`,
    dueRemoved: 'Rok uklonjen',
    overdue: (date) => `Rok je istekao ${date}`,
    ticketResolved: (n) => `Tiket #${n} je riješen`,
  },
  teams: {
    recordingNotice: 'Ovaj poziv bit će snimljen i transkribiran.',
    recordingMayNotice: 'Ovaj poziv može biti snimljen i transkribiran.',
    addToCalendar: 'Dodaj u kalendar:',
    join: 'Pridruži se u Teamsu:',
  },
};
