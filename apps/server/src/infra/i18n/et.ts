import type { TicketStatus } from '@spolu/shared';
import { plural } from './plural.js';
import type { ServerTexts } from './types.js';

const STATUS: Record<TicketStatus, string> = {
  new: 'Uus',
  in_progress: 'Töös',
  resolved: 'Lahendatud',
};

export const et: ServerTexts = {
  intl: 'et-EE',
  email: {
    footer: ['Help by eGrant', 'See e-kiri saadeti automaatselt rakendusest Help by eGrant.'],
  },
  bulkEmail: {
    reason: 'Saate selle e-kirja, sest Teil on konto rakenduses Help by eGrant.',
    unsubscribe: 'Loobu tellimusest',
  },
  auth: {
    loginCode: {
      subject: (code) => `Teie Help-rakenduse sisselogimiskood: ${code}`,
      heading: 'Teie sisselogimiskood',
      body: 'See kehtib 5 minutit. Kui Te seda ei küsinud, jätke see e-kiri tähelepanuta.',
    },
    adminAdded: {
      subject: 'Teid lisati rakendusse Help by eGrant',
      greeting: (name) => `Tere, ${name}!`,
      body: ({ addedBy, email }) =>
        `${addedBy} lisas Teid rakenduse Help by eGrant administraatoriks. Logige sisse oma e-posti aadressiga ${email}.`,
      button: 'Logi sisse',
    },
    memberInvited: {
      subject: (group) => `Kutse rakendusse Help by eGrant – ${group}`,
      body: ({ invitedBy, groupName, email }) =>
        `${invitedBy} kutsus Teid rakenduses Help by eGrant gruppi ${groupName}. Logige sisse oma e-posti aadressiga ${email}.`,
      button: 'Logi sisse',
    },
    memberAdded: {
      subject: (group) => `Teid lisati gruppi ${group}`,
      body: ({ addedBy, groupName }) =>
        `${addedBy} lisas Teid rakenduses Help by eGrant gruppi ${groupName}.`,
      button: 'Ava grupp',
    },
    emailChangeCode: {
      subject: (code) => `Teie Help-rakenduse e-posti aadressi muutmise kood: ${code}`,
      heading: 'Teie e-posti aadressi muutmise kood',
      body: (email) =>
        `Sisestage see Help-rakenduses ja Teie e-posti aadressiks saab ${email}. Kood kehtib 5 minutit. Kui Te seda ei küsinud, jätke see e-kiri tähelepanuta.`,
    },
    emailChanged: {
      subject: 'Teie Help-rakenduse e-posti aadress on muudetud',
      body: (newEmail) =>
        `Teie Help-rakenduse konto e-posti aadressiks on nüüd ${newEmail}. Edaspidi logige sisse uue aadressiga.`,
      warning: 'Kui Te seda ei teinud, võtke kohe ühendust oma administraatoriga.',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Pöördumine #${n} on loodud: ${title}`,
      untitled: 'Teie päring',
      received: (n, title) => `Saime kätte Teie tugipöördumise #${n}: ${title}.`,
      followUp:
        'Help-rakenduses saate seda jälgida ja eGrantile kirjutada. Logige sisse selle e-posti aadressiga, saadame Teile koodi.',
      button: 'Ava pöördumine',
    },
  },
  notifications: {
    sentFile: (name) => `${name} saatis faili`,
    moved: (label) => `Teisaldatud veergu ${label}`,
    movedGeneric: 'Ülesanne teisaldatud',
    assigned: (name) => `${name} määras Teid selle ülesande täitjaks`,
    deadline: (d) =>
      d === 1
        ? 'Tähtaeg homme'
        : `Tähtaeg ${d} ${plural('et', d, { one: 'päeva', other: 'päeva' })} pärast`,
    urgent: 'Kiire: endiselt avatud',
    bucket: (l) => {
      switch (l.kind) {
        case 'todo':
          return 'Teha';
        case 'egrant_review':
          return 'eGranti ülevaatus';
        case 'client_review':
          return l.name ? `Ülevaatus: ${l.name}` : 'Ülevaatus';
        case 'done':
          return 'Lõpetatud';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('et', n, { one: 'uus sõnum', other: 'uut sõnumit' })} grupis ${g}`,
    digestButton: (g) => `Ava: ${g}`,
    reminderDue: (time) => `Meeldetuletus: ${time}`,
    reminderLine: (title, time) => `Meeldetuletus: ${title}, ${time}`,
    deadlineEvent: (title) => `Tähtaeg: ${title}`,
    ticketNew: (n, client) => `Uus pöördumine #${n} · ${client}`,
    ticketUnassigned: (n) => `Uus pöördumine #${n} kliendita`,
    ticketStatus: (n, status) => `#${n} olek: ${STATUS[status] ?? status}`,
    ticketAssigned: (n) => `Olete pileti #${n} lahendaja`,
    ticketUpdated: (n) => `#${n} on muudetud`,
    ticketTasks: (n, c) =>
      `#${n} muudeti ${c} ${plural('et', c, { one: 'ülesandeks', other: 'ülesandeks' })}`,
    ticketTopic: (n) => `Pöördumine #${n}`,
    openTicket: 'Ava pöördumine',
  },
};
