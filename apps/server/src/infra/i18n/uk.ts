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
    passkeyCode: {
      subject: (code) => `Код для додавання ключа доступу (passkey) у Help: ${code}`,
      heading: 'Код для додавання ключа доступу (passkey)',
      body: 'Введіть його в застосунку Help, щоб додати ключ доступу (passkey) до свого облікового запису. Код дійсний 5 хвилин. Якщо Ви його не запитували, проігноруйте цей лист.',
    },
    passkeyAdded: {
      subject: 'До Вашого облікового запису Help додано новий ключ доступу (passkey)',
      body: ({ name, date }) =>
        `До Вашого облікового запису Help by eGrant ${date} додано новий ключ доступу (passkey) «${name}». З ним можна входити без коду з електронної пошти.`,
      warning:
        'Якщо це були не Ви, негайно видаліть його в Налаштуваннях → Ключі доступу (passkeys) і зверніться до свого адміністратора.',
      button: 'Відкрити Налаштування',
    },
  },
  mcp: {
    tokenCreated: {
      subject: 'У Help створено новий токен доступу для ШІ',
      body: ({ name, date }) =>
        `У Help by eGrant ${date} створено новий токен доступу для ШІ «${name}». З ним ШІ-асистент може читати й змінювати дані від вашого імені.`,
      warning:
        'Якщо це були не ви, негайно відкличте його в Налаштуваннях → Доступ для ШІ (MCP) і зверніться до свого адміністратора.',
      button: 'Відкрити Налаштування',
    },
    connectionApproved: {
      subject: 'До Help підключено ШІ-асистента',
      body: ({ name, host, date }) =>
        `${date} до Help by eGrant підключено асистента «${name}» (повернення на ${host}). Тепер він може користуватися Help від вашого імені з доступом, який ви обрали.`,
      warning:
        'Якщо це були не ви, негайно відключіть його в Налаштуваннях → Доступ для ШІ (MCP) і зверніться до свого адміністратора.',
      button: 'Відкрити Налаштування',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Тікет #${n} створено: ${title}`,
      untitled: 'Ваш запит',
      received: (n, title) => `Ми отримали Ваш тікет #${n}: ${title}.`,
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
          return 'Перевіряє eGrant';
        case 'client_review':
          return `Перевіряє ${l.name ?? 'клієнт'}`;
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
      })} – ${g}`,
    digestButton: (g) => `Відкрити ${g}`,
    reminderDue: (time) => `Нагадування на ${time}`,
    reminderLine: (title, time) => `Нагадування: ${title}, ${time}`,
    deadlineEvent: (title) => `Термін: ${title}`,
    ticketNew: (n, client) => `Новий тікет #${n} · ${client}`,
    ticketUnassigned: (n) => `Новий тікет #${n} без клієнта`,
    ticketStatus: (n, status) => `Тікет #${n}: статус «${STATUS[status] ?? status}»`,
    ticketAssigned: (n) => `Ви — виконавець тікета #${n}`,
    ticketUpdated: (n) => `Тікет #${n}: дані змінено`,
    ticketTasks: (n, c) =>
      `Тікет #${n}: створено ${c} ${plural('uk', c, { one: 'завдання', few: 'завдання', many: 'завдань', other: 'завдання' })}`,
    ticketTopic: (n) => `Тікет #${n}`,
    openTicket: 'Відкрити тікет',
    meetingScheduled: (when) => `Нова зустріч: ${when}`,
    meetingRescheduled: (when) => `Зустріч перенесено на ${when}`,
    meetingSummaryReady: 'Підсумок від ШІ готовий',
    meetingSummaryFailed: 'Не вдалося обробити за допомогою ШІ',
    openMeeting: 'Відкрити зустріч',
    contractEnds: (date) => `Договір закінчується ${date}`,
    contractLine: (title, client, date) => `Договір ${title} · ${client}: закінчується ${date}`,
    openContract: 'Відкрити договір',
    expenseDue: (date) => `Витрата до сплати ${date}`,
    expenseLine: (title, date) => `Витрата ${title}: до сплати ${date}`,
    salaryTitle: (name) => `Зарплата: ${name}`,
    openExpense: 'Відкрити витрату',
    financeTopic: 'Фінанси',
    timeMissing: 'Запишіть витрачений час',
    timeMissingLine: (title) => `${title}: запишіть витрачений час`,
    openTask: 'Відкрити завдання',
    digestUpdates: (n, topic) =>
      `${topic}: ${n} ${plural('uk', n, { one: 'зміна', few: 'зміни', many: 'змін', other: 'зміни' })}`,
    digestMany: (n, topics, more) =>
      `${n} ${plural('uk', n, { one: 'зміна', few: 'зміни', many: 'змін', other: 'зміни' })}: ${topics.join(', ')}${more > 0 ? ` і ще ${more}` : ''}`,
    digestMore: (n) => `І ще ${n} у Help.`,
    dueChanged: (date) => `Термін змінено на ${date}`,
    dueRemoved: 'Термін прибрано',
    overdue: (date) => `Прострочено, термін був ${date}`,
    ticketResolved: (n) => `Тікет #${n} вирішено`,
    ticketRated: (n) => `Тікет #${n}: негативна оцінка`,
    mentionedInDescription: (name) => `${name} згадав(ла) вас в описі`,
    openKnowledge: 'Відкрити елемент',
    openProject: 'Відкрити проєкт',
    actionDone: 'Готово',
    actionLogTime: 'Записати час',
    actionReply: 'Відповісти',
    replyPlaceholder: 'Напишіть відповідь…',
  },
  teams: {
    recordingNotice: 'Цей дзвінок буде записано й транскрибовано.',
    recordingMayNotice: 'Цей дзвінок може бути записано й транскрибовано.',
    addToCalendar: 'Додати до календаря:',
    join: 'Приєднатися в Teams:',
  },
  calendarFeed: {
    name: (userName) => `Help – ${userName}`,
    eventSummary: (project, event) => `${project} · ${event}`,
    callSummary: (title) => `Дзвінок: ${title}`,
    withGroup: (group, summary) => `${group}: ${summary}`,
    createdEmail: {
      subject: 'Ви створили посилання для підписки на календар',
      lines: [
        'Для вашого облікового запису в Help створено посилання для підписки на календар.',
        'Якщо це були не ви, відкрийте Налаштування й скасуйте підписку.',
      ],
      button: 'Відкрити налаштування',
    },
  },
  weeklySummary: {
    subject: (group, range) => `Тижневий огляд: ${group}, ${range}`,
    heading: 'Тижневий огляд роботи',
    done: 'Що ми зробили',
    waiting: 'Що нам потрібно від вас',
    upcoming: 'Що нас чекає',
    button: 'Відкрити в Help',
    factsIntro: (range) => `Добрий день, надсилаємо вам огляд роботи за період ${range}.`,
    factsClosing: 'Якщо у вас є запитання, відповідайте в чаті групи в Help.',
    footer: (group, url) => `Ви отримуєте цей огляд як учасник групи ${group}. Відписатися: ${url}`,
    testPrefix: '[Test]',
    reminder: {
      subject: (n) => `Тижневі огляди на перевірку: ${n}`,
      body: (groups, more) =>
        `Ми підготували чернетки тижневих оглядів для ваших клієнтів: ${groups.join(', ')}${more > 0 ? ` і ще ${more}` : ''}. Перевірте їх і надішліть.`,
      button: 'Перевірити',
    },
  },
};
