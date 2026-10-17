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
  tickets: {
    created: {
      subject: (n, title) => `Tiket #${n} je stvoren: ${title}`,
      untitled: 'Vaš zahtjev',
      received: (n, title) => `Primili smo Vaš tiket tehničke podrške #${n}: ${title}.`,
      followUp:
        'U aplikaciji Help možete ga pratiti i pisati eGrantu. Prijavite se ovom adresom e-pošte; poslat ćemo Vam kôd.',
      followUpLink:
        'U aplikaciji Help možete ga pratiti i pisati eGrantu. Gumb Vas prijavljuje izravno, bez kôda, i vrijedi 7 dana. Ne prosljeđujte ovu e-poruku.',
      button: 'Otvori tiket',
    },
  },
  notifications: {
    sentFile: (name) => `${name} poslao/la je datoteku`,
    moved: (label) => `Premješteno u ${label}`,
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
          return 'Pregled eGranta';
        case 'client_review':
          return l.name ? `Pregled: ${l.name}` : 'Pregled klijenta';
        case 'done':
          return 'Dovršeno';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('hr', n, { one: 'nova poruka', few: 'nove poruke', other: 'novih poruka' })} u grupi ${g}`,
    digestButton: (g) => `Otvori ${g}`,
    reminderDue: (time) => `Podsjetnik za ${time}`,
    reminderLine: (title, time) => `Podsjetnik: ${title}, ${time}`,
    deadlineEvent: (title) => `Rok: ${title}`,
    ticketNew: (n, client) => `Novi tiket #${n} · ${client}`,
    ticketUnassigned: (n) => `Novi tiket #${n} bez klijenta`,
    ticketStatus: (n, status) => `#${n} sada ima status: ${STATUS[status] ?? status}`,
    ticketAssigned: (n) => `Vi ste rješavatelj tiketa #${n}`,
    ticketUpdated: (n) => `#${n} je promijenjen`,
    ticketTasks: (n, c) =>
      `#${n} pretvoren u ${c} ${plural('hr', c, { one: 'zadatak', few: 'zadatka', other: 'zadataka' })}`,
    ticketTopic: (n) => `Tiket #${n}`,
    openTicket: 'Otvori tiket',
    meetingScheduled: (when) => `Novi sastanak: ${when}`,
    meetingRescheduled: (when) => `Sastanak premješten na ${when}`,
    meetingSummaryReady: 'AI sažetak je spreman',
    meetingSummaryFailed: 'Obrada s AI-jem nije uspjela',
    openMeeting: 'Otvori sastanak',
    timeMissing: 'Upišite koliko ste vremena utrošili',
    timeMissingLine: (title) => `${title}: upišite svoje vrijeme`,
    openTask: 'Otvori zadatak',
  },
};
