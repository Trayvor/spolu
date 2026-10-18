import type { TicketStatus } from '@spolu/shared';
import { plural } from './plural.js';
import type { ServerTexts } from './types.js';

const STATUS: Record<TicketStatus, string> = {
  new: 'Нов',
  in_progress: 'В процес',
  resolved: 'Решен',
};

export const bg: ServerTexts = {
  intl: 'bg-BG',
  email: {
    footer: ['Help by eGrant', 'Този имейл е изпратен автоматично от приложението Help by eGrant.'],
  },
  bulkEmail: {
    reason: 'Получавате този имейл, защото имате профил в приложението Help by eGrant.',
    unsubscribe: 'Отписване',
  },
  auth: {
    loginCode: {
      subject: (code) => `Вашият код за вход в приложението Help: ${code}`,
      heading: 'Вашият код за вход',
      body: 'Валиден е 5 минути. Ако не сте го поискали, не обръщайте внимание на този имейл.',
    },
    adminAdded: {
      subject: 'Добавени сте в приложението Help',
      greeting: (name) => `Здравейте, ${name},`,
      body: ({ addedBy, email }) =>
        `${addedBy} Ви добави като администратор в приложението Help by eGrant. Влезте със своя имейл ${email}.`,
      button: 'Вход',
    },
    memberInvited: {
      subject: (group) => `Покана за приложението Help – ${group}`,
      body: ({ invitedBy, groupName, email }) =>
        `${invitedBy} Ви покани в групата ${groupName} в приложението Help by eGrant. Влезте със своя имейл ${email}.`,
      button: 'Вход',
    },
    memberAdded: {
      subject: (group) => `Добавени сте в групата ${group}`,
      body: ({ addedBy, groupName }) =>
        `${addedBy} Ви добави в групата ${groupName} в приложението Help by eGrant.`,
      button: 'Отвори групата',
    },
    emailChangeCode: {
      subject: (code) => `Код за промяна на имейла в приложението Help: ${code}`,
      heading: 'Код за промяна на имейла',
      body: (email) =>
        `Въведете го в приложението Help и имейлът Ви ще бъде променен на ${email}. Валиден е 5 минути. Ако не сте го поискали, не обръщайте внимание на този имейл.`,
    },
    emailChanged: {
      subject: 'Вашият имейл в приложението Help е променен',
      body: (newEmail) =>
        `Имейлът на Вашия профил в приложението Help е променен на ${newEmail}. Отсега нататък влизайте с новия адрес.`,
      warning: 'Ако не сте били Вие, свържете се незабавно със своя администратор.',
    },
  },
  mcp: {
    tokenCreated: {
      subject: 'Създаден е нов токен за достъп на AI в Help',
      body: ({ name, date }) =>
        `В Help by eGrant на ${date} е създаден нов токен за достъп на AI „${name}“. С него AI асистент може да чете и променя данни от ваше име.`,
      warning:
        'Ако не сте били вие, незабавно го отменете в Настройки → Достъп за AI (MCP) и се свържете с администратора си.',
      button: 'Отвори Настройки',
    },
    connectionApproved: {
      subject: 'Към Help беше свързан AI асистент',
      body: ({ name, host, date }) =>
        `На ${date} към Help by eGrant беше свързан асистентът „${name}“ (връщане към ${host}). Вече може да използва Help от ваше име с избрания от вас достъп.`,
      warning:
        'Ако не сте били вие, незабавно го изключете в Настройки → Достъп за AI (MCP) и се свържете с администратора си.',
      button: 'Отвори Настройки',
    },
  },
  tickets: {
    created: {
      subject: (n, title) => `Тикет #${n} е създаден: ${title}`,
      untitled: 'Вашата заявка',
      received: (n, title) => `Получихме Вашия тикет #${n}: ${title}.`,
      followUp:
        'Можете да го следите и да пишете на eGrant в приложението Help. Влезте с този имейл адрес; ще Ви изпратим код.',
      followUpLink:
        'Можете да го следите и да пишете на eGrant в приложението Help. Бутонът Ви вписва директно, без код, и е валиден 7 дни. Не препращайте този имейл.',
      button: 'Отвори тикета',
    },
  },
  notifications: {
    sentFile: (name) => `${name} изпрати файл`,
    moved: (label) => `Преместена в колона „${label}“`,
    movedGeneric: 'Задачата е преместена',
    assigned: (name) => `${name} Ви възложи тази задача`,
    deadline: (d) =>
      d === 1 ? 'Срок утре' : `Срок след ${d} ${plural('bg', d, { one: 'ден', other: 'дни' })}`,
    urgent: 'Спешно: все още отворена',
    bucket: (l) => {
      switch (l.kind) {
        case 'todo':
          return 'За изпълнение';
        case 'egrant_review':
          return 'Проверка от eGrant';
        case 'client_review':
          return l.name ? `Проверка от ${l.name}` : 'Проверка от клиента';
        case 'done':
          return 'Завършени';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('bg', n, { one: 'ново съобщение', other: 'нови съобщения' })} – ${g}`,
    digestButton: () => 'Отвори групата',
    reminderDue: (time) => `Напомняне за ${time}`,
    reminderLine: (title, time) => `Напомняне: ${title}, ${time}`,
    deadlineEvent: (title) => `Срок: ${title}`,
    ticketNew: (n, client) => `Нов тикет #${n} · ${client}`,
    ticketUnassigned: (n) => `Нов тикет #${n} без клиент`,
    ticketStatus: (n, status) => `Тикет #${n}: статус „${STATUS[status] ?? status}“`,
    ticketAssigned: (n) => `Вие сте отговорник за #${n}`,
    ticketUpdated: (n) => `Тикет #${n}: обновени данни`,
    ticketTasks: (n, c) =>
      `Тикет #${n}: ${plural('bg', c, { one: 'създадена', other: 'създадени' })} ${c} ${plural('bg', c, { one: 'задача', other: 'задачи' })}`,
    ticketTopic: (n) => `Тикет #${n}`,
    openTicket: 'Отвори тикета',
    meetingScheduled: (when) => `Нова среща: ${when}`,
    meetingRescheduled: (when) => `Срещата е преместена за ${when}`,
    meetingSummaryReady: 'Резюмето от AI е готово',
    meetingSummaryFailed: 'Обработката с AI не успя',
    openMeeting: 'Отвори срещата',
    contractEnds: (date) => `Договорът изтича на ${date}`,
    contractLine: (title, client, date) => `Договор ${title} · ${client}: изтича на ${date}`,
    openContract: 'Отвори договора',
    expenseDue: (date) => `Разход с падеж ${date}`,
    expenseLine: (title, date) => `Разход ${title}: падеж ${date}`,
    salaryTitle: (name) => `Заплата: ${name}`,
    openExpense: 'Отвори разхода',
    financeTopic: 'Финанси',
    timeMissing: 'Запишете отделеното време',
    timeMissingLine: (title) => `${title}: запишете отделеното време`,
    openTask: 'Отвори задачата',
  },
};
