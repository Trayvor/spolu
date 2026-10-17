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
  tickets: {
    created: {
      subject: (n, title) => `Тикет #${n} е създаден: ${title}`,
      untitled: 'Вашата заявка',
      received: (n, title) => `Получихме Вашия тикет за поддръжка #${n}: ${title}.`,
      followUp:
        'Можете да го следите и да пишете на eGrant в приложението Help. Влезте с този имейл адрес; ще Ви изпратим код.',
      followUpLink:
        'Можете да го следите и да пишете на eGrant в приложението Help. Бутонът Ви вписва директно, без код, и е валиден 7 дни. Не препращайте този имейл.',
      button: 'Отвори тикета',
    },
  },
  notifications: {
    sentFile: (name) => `${name} изпрати файл`,
    moved: (label) => `Преместена в ${label}`,
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
          return 'Преглед от eGrant';
        case 'client_review':
          return `Преглед от ${l.name ?? ''}`.trim();
        case 'done':
          return 'Завършени';
        case 'custom':
          return l.name ?? '';
      }
    },
    digestSubject: (n, g) =>
      `${n} ${plural('bg', n, { one: 'ново съобщение', other: 'нови съобщения' })} в ${g}`,
    digestButton: (g) => `Отвори ${g}`,
    reminderDue: (time) => `Напомняне за ${time}`,
    reminderLine: (title, time) => `Напомняне: ${title}, ${time}`,
    deadlineEvent: (title) => `Срок: ${title}`,
    ticketNew: (n, client) => `Нов тикет #${n} · ${client}`,
    ticketUnassigned: (n) => `Нов тикет #${n} без клиент`,
    ticketStatus: (n, status) => `#${n} вече е със статус „${STATUS[status] ?? status}“`,
    ticketAssigned: (n) => `Вие сте отговорник за #${n}`,
    ticketUpdated: (n) => `#${n} е променен`,
    ticketTasks: (n, c) =>
      `#${n} е превърнат в ${c} ${plural('bg', c, { one: 'задача', other: 'задачи' })}`,
    ticketTopic: (n) => `Тикет #${n}`,
    openTicket: 'Отвори тикета',
    meetingScheduled: (when) => `Нова среща: ${when}`,
    meetingRescheduled: (when) => `Срещата е преместена за ${when}`,
    meetingSummaryReady: 'AI резюмето е готово',
    meetingSummaryFailed: 'Обработката с AI не успя',
    openMeeting: 'Отвори срещата',
    timeMissing: 'Попълнете колко време отделихте',
    timeMissingLine: (title) => `${title}: попълнете времето си`,
    openTask: 'Отвори задачата',
  },
};
