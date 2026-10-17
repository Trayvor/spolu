import type { TicketStatus } from '@spolu/shared';
import { plural } from './plural.js';
import type { ServerTexts } from './types.js';

const STATUS: Record<TicketStatus, string> = {
  new: 'Новий',
  in_progress: 'У роботі',
  resolved: 'Вирішено',
};

export const uk: ServerTexts = {
  intl: 'uk-UA',
  email: {
    footer: ['Help by eGrant', 'Цей лист надіслано автоматично із застосунку Help by eGrant.'],
  },
  bulkEmail: {
    reason: 'Ви отримуєте цей лист, бо маєте обліковий запис у застосунку Help by eGrant.',
    unsubscribe: 'Відписатися від розсилки',
  },
  auth: {
    loginCode: {
      subject: (code) => `Ваш код для входу в застосунок Help: ${code}`,
      heading: 'Ваш код для входу',
      body: 'Він дійсний 5 хвилин. Якщо Ви його не запитували, просто проігноруйте цей лист.',
    },
    adminAdded: {
      subject: 'Вас додано до застосунку Help',
      greeting: (name) => `Добрий день, ${name}!`,
      body: ({ addedBy, email }) =>
        `${addedBy} додав(-ла) Вас як адміністратора в застосунку Help by eGrant. Увійдіть зі своєю адресою електронної пошти ${email}.`,
      button: 'Увійти',
    },
    memberInvited: {
      subject: (group) => `Запрошення до застосунку Help – ${group}`,
      body: ({ invitedBy, groupName, email }) =>
        `${invitedBy} запросив(-ла) Вас до групи ${groupName} у застосунку Help by eGrant. Увійдіть зі своєю адресою електронної пошти ${email}.`,
      button: 'Увійти',
    },
    memberAdded: {
      subject: (group) => `Вас додано до групи ${group}`,
      body: ({ addedBy, groupName }) =>
        `${addedBy} додав(-ла) Вас до групи ${groupName} у застосунку Help by eGrant.`,
      button: 'Відкрити групу',
    },
    emailChangeCode: {
      subject: (code) => `Код для зміни електронної пошти в застосунку Help: ${code}`,
      heading: 'Код для зміни електронної пошти',
      body: (email) =>
        `Введіть його в застосунку Help, і Вашу адресу буде змінено на ${email}. Він дійсний 5 хвилин. Якщо Ви його не запитували, просто проігноруйте цей лист.`,
    },
    emailChanged: {
      subject: 'Вашу адресу електронної пошти в застосунку Help змінено',
      body: (newEmail) =>
        `Адресу електронної пошти Вашого облікового запису в застосунку Help змінено на ${newEmail}. Відтепер входьте з новою адресою.`,
      warning: 'Якщо це були не Ви, негайно зверніться до свого адміністратора.',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Тікет #${n} створено: ${title}`,
      untitled: 'Ваш запит',
      received: (n, title) => `Ми отримали Ваш тікет технічної підтримки #${n}: ${title}.`,
      followUp:
        'У застосунку Help Ви можете стежити за ним і писати eGrant. Увійдіть із цією адресою електронної пошти, і ми надішлемо Вам код.',
      followUpLink:
        'У застосунку Help Ви можете стежити за ним і писати eGrant. Кнопка виконає вхід одразу, без коду, і діє 7 днів. Не пересилайте цей лист.',
      button: 'Відкрити тікет',
    },
  },
  notifications: {
    sentFile: (name) => `${name} надіслав(-ла) файл`,
    moved: (label) => `Переміщено до стовпця «${label}»`,
    movedGeneric: 'Завдання переміщено',
    assigned: (name) => `${name} призначив(-ла) Вам це завдання`,
    deadline: (d) =>
      d === 1
        ? 'Термін завтра'
        : `Термін через ${d} ${plural('uk', d, { one: 'день', few: 'дні', many: 'днів', other: 'дня' })}`,
    urgent: 'Термінове: досі відкрите',
    bucket: (l) => {
      switch (l.kind) {
        case 'todo':
          return 'До виконання';
        case 'egrant_review':
          return 'Перевірка eGrant';
        case 'client_review':
          return `Перевірка ${l.name ?? ''}`.trim();
        case 'done':
          return 'Виконано';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('uk', n, {
        one: 'нове повідомлення',
        few: 'нові повідомлення',
        many: 'нових повідомлень',
        other: 'нового повідомлення',
      })} у ${g}`,
    digestButton: (g) => `Відкрити ${g}`,
    reminderDue: (time) => `Нагадування на ${time}`,
    reminderLine: (title, time) => `Нагадування: ${title}, ${time}`,
    deadlineEvent: (title) => `Термін: ${title}`,
    ticketNew: (n, client) => `Новий тікет #${n} · ${client}`,
    ticketUnassigned: (n) => `Новий тікет #${n} без клієнта`,
    ticketStatus: (n, status) => `#${n}: статус «${STATUS[status] ?? status}»`,
    ticketAssigned: (n) => `Ви — виконавець тікета #${n}`,
    ticketUpdated: (n) => `#${n} змінено`,
    ticketTasks: (n, c) =>
      `#${n} перетворено на ${c} ${plural('uk', c, { one: 'завдання', few: 'завдання', many: 'завдань', other: 'завдання' })}`,
    ticketTopic: (n) => `Тікет #${n}`,
    openTicket: 'Відкрити тікет',
    meetingScheduled: (when) => `Нова зустріч: ${when}`,
    meetingRescheduled: (when) => `Зустріч перенесено на ${when}`,
    meetingSummaryReady: 'AI-підсумок готовий',
    meetingSummaryFailed: 'Не вдалося обробити за допомогою AI',
    openMeeting: 'Відкрити зустріч',
    contractEnds: (date) => `Договір закінчується ${date}`,
    contractLine: (title, client, date) => `Договір ${title} · ${client}: закінчується ${date}`,
    openContract: 'Відкрити договір',
  },
};
